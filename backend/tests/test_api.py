import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.schemas import Detection


class FakeDetector:
    loaded = True
    classes = ["fire", "smoke"]
    device = "cpu"

    def predict(self, frame, conf):
        return [Detection(label="fire", confidence=0.9, box=(0.1, 0.1, 0.6, 0.6))]


class EmptyDetector(FakeDetector):
    loaded = False
    classes: list[str] = []

    def predict(self, frame, conf):  # pragma: no cover
        raise AssertionError("should not be called")


def jpeg(w=64, h=48) -> bytes:
    ok, buf = cv2.imencode(".jpg", np.full((h, w, 3), 127, np.uint8))
    assert ok
    return buf.tobytes()


@pytest.fixture()
def client():
    app.state.detector = FakeDetector()
    with TestClient(app) as c:
        yield c


def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200 and r.json()["status"] == "ok"


def test_image_detection_logs_incident(client):
    r = client.post("/api/detect/image", files={"file": ("a.jpg", jpeg(), "image/jpeg")})
    assert r.status_code == 200
    body = r.json()
    assert body["alert"] and body["detections"][0]["label"] == "fire"
    assert body["annotated"].startswith("data:image/jpeg;base64,")
    assert client.delete(f"/api/incidents/{body['incident_id']}").status_code == 204


def test_bad_image_rejected(client):
    r = client.post("/api/detect/image", files={"file": ("a.jpg", b"nope", "image/jpeg")})
    assert r.status_code == 400


def test_websocket_stream_and_cooldown(client):
    with client.websocket_connect("/ws/stream") as ws:
        ws.send_bytes(jpeg())
        first = ws.receive_json()
        ws.send_bytes(jpeg())
        second = ws.receive_json()
    assert first["alert"] and first["incident_id"] is not None
    assert second["incident_id"] is None  # inside cooldown
    client.delete(f"/api/incidents/{first['incident_id']}")


def test_stats_shape(client):
    s = client.get("/api/stats").json()
    assert len(s["hourly"]) == 24 and {"total", "fire", "smoke"} <= s.keys()


def test_model_missing_returns_503():
    app.state.detector = EmptyDetector()
    with TestClient(app) as c:
        assert c.get("/api/health").json()["status"] == "model_missing"
        r = c.post("/api/detect/image", files={"file": ("a.jpg", jpeg(), "image/jpeg")})
        assert r.status_code == 503

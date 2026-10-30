from fastapi.testclient import TestClient

from app.main import app
from conftest import MissingModel


def test_health(client):
    body = client.get("/api/health").json()
    assert body["status"] == "ok" and body["cameras_total"] == 0


def test_image_detection_logs_incident(client, jpeg):
    r = client.post("/api/detect/image", files={"file": ("a.jpg", jpeg, "image/jpeg")})
    assert r.status_code == 200
    body = r.json()
    assert body["alert"] and body["detections"][0]["label"] == "fire"
    assert body["annotated"].startswith("data:image/jpeg;base64,")
    assert client.delete(f"/api/incidents/{body['incident_id']}").status_code == 204


def test_bad_image_rejected(client):
    r = client.post("/api/detect/image", files={"file": ("a.jpg", b"nope", "image/jpeg")})
    assert r.status_code == 400


def test_websocket_requires_confirmation_then_respects_cooldown(client, jpeg):
    """Default policy is 3 of the last 5 frames, so frames 1-2 are not yet an alarm."""
    with client.websocket_connect("/ws/stream") as ws:
        replies = []
        for _ in range(4):
            ws.send_bytes(jpeg)
            replies.append(ws.receive_json())
    assert [r["alert"] for r in replies] == [False, False, True, True]
    assert replies[2]["incident_id"] is not None  # logged on confirmation
    assert replies[3]["incident_id"] is None  # inside the cooldown
    client.delete(f"/api/incidents/{replies[2]['incident_id']}")


def test_model_missing_returns_503():
    app.state.detector = MissingModel()
    with TestClient(app) as c:
        assert c.get("/api/health").json()["status"] == "model_missing"
        r = c.post("/api/detect/image", files={"file": ("a.jpg", b"x", "image/jpeg")})
        assert r.status_code == 503

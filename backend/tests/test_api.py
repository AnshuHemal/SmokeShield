from fastapi.testclient import TestClient

from app.main import app
from conftest import FakeDetector, MissingModel


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


def live_incident_ids(client) -> set[int]:
    return {i["id"] for i in client.get("/api/incidents?limit=500").json() if i["source"] == "live"}


def test_stream_confirms_after_n_frames_and_records_one_incident(client, jpeg):
    """Default policy is 3 hits: frames 1-2 are shown as "possible", frame 3 is the alarm."""
    before = live_incident_ids(client)
    with client.websocket_connect("/ws/stream?conf=0.4") as ws:
        replies = []
        for _ in range(5):
            ws.send_bytes(jpeg)
            replies.append(ws.receive_json())
    assert [r["alert"] for r in replies] == [False, False, True, True, True]
    assert replies[0]["pending"] and not replies[0]["detections"]  # "verifying", not yet an alarm
    assert replies[2]["detections"][0]["label"] == "fire" and replies[2]["confirmed"] == ["fire"]

    new = live_incident_ids(client) - before
    assert len(new) == 1, "a continuous fire must be ONE incident, not one per cooldown"
    incident = next(i for i in client.get("/api/incidents?limit=500").json() if i["id"] in new)
    assert incident["ended_at"] is not None and incident["duration_s"] is not None  # closed when the page left
    client.delete(f"/api/incidents/{incident['id']}")


def test_stream_confirms_instantly_on_one_very_confident_detection(client, jpeg):
    client.app.state.models.set_current(FakeDetector(confidence=0.9))
    before = live_incident_ids(client)
    with client.websocket_connect("/ws/stream?conf=0.4") as ws:
        ws.send_bytes(jpeg)
        reply = ws.receive_json()
    assert reply["alert"] is True  # no waiting for N frames when the model is this sure
    for i in live_incident_ids(client) - before:
        client.delete(f"/api/incidents/{i}")


def test_stream_keeps_the_box_through_a_missed_frame_instead_of_blinking(client, jpeg):
    before = live_incident_ids(client)
    with client.websocket_connect("/ws/stream?conf=0.4") as ws:
        for _ in range(3):  # confirm the alarm
            ws.send_bytes(jpeg)
            ws.receive_json()
        client.app.state.models.set_current(FakeDetector(confidence=0.1))  # the flame flickers out of detection
        ws.send_bytes(jpeg)
        reply = ws.receive_json()
    assert reply["alert"] is True and reply["detections"][0]["held"] is True  # still on, drawn as last known
    for i in live_incident_ids(client) - before:
        client.delete(f"/api/incidents/{i}")


def test_stream_reports_weak_candidates_below_the_threshold_without_alarming(client, jpeg):
    """Lets the user see 'the model half-sees it' instead of a silent miss."""
    client.app.state.models.set_current(FakeDetector(confidence=0.2))
    with client.websocket_connect("/ws/stream?conf=0.4") as ws:
        ws.send_bytes(jpeg)
        reply = ws.receive_json()
    assert reply["alert"] is False and reply["detections"] == [] and reply["pending"] == []
    assert reply["weak"][0]["label"] == "fire" and reply["weak"][0]["confidence"] == 0.2


def test_stream_passes_the_inference_size_through_and_ignores_bad_values(client, jpeg):
    fake = FakeDetector(confidence=0.2)
    client.app.state.models.set_current(fake)
    with client.websocket_connect("/ws/stream?conf=0.4&imgsz=960") as ws:
        ws.send_bytes(jpeg)
        ws.receive_json()
        ws.send_text('{"imgsz": 1280}')  # changed live
        ws.send_bytes(jpeg)
        ws.receive_json()
        ws.send_text('{"imgsz": 123}')  # not an allowed size: back to the model default
        ws.send_bytes(jpeg)
        ws.receive_json()
    assert fake.seen_imgsz == {960, 1280, None}


def test_model_missing_returns_503():
    app.state.detector = MissingModel()
    with TestClient(app) as c:
        assert c.get("/api/health").json()["status"] == "model_missing"
        r = c.post("/api/detect/image", files={"file": ("a.jpg", b"x", "image/jpeg")})
        assert r.status_code == 503

import time

from conftest import make_video

STREAM = {"name": "Lobby", "source_type": "stream", "source": "rtsp://admin:secret@192.168.1.10/live"}


def wait_for(predicate, timeout=20.0, step=0.25):
    end = time.time() + timeout
    while time.time() < end:
        value = predicate()
        if value:
            return value
        time.sleep(step)
    return None


def test_create_list_update_delete(client):
    created = client.post("/api/cameras", json={**STREAM, "enabled": False})
    assert created.status_code == 201
    cam = created.json()
    assert "secret" not in cam["source"] and "***" in cam["source"]  # password masked

    assert [c["name"] for c in client.get("/api/cameras").json()] == ["Lobby"]

    patched = client.patch(f"/api/cameras/{cam['id']}", json={"confidence": 0.6, "confirm_frames": 2})
    assert patched.status_code == 200 and patched.json()["confidence"] == 0.6

    # echoing the masked URL back must keep the stored password
    client.patch(f"/api/cameras/{cam['id']}", json={"source": cam["source"], "name": "Lobby 2"})
    assert client.delete(f"/api/cameras/{cam['id']}").status_code == 204
    assert client.get(f"/api/cameras/{cam['id']}").status_code == 404


def test_validation_rules(client):
    bad = [
        {**STREAM, "source": "ftp://host/x"},
        {**STREAM, "source_type": "device", "source": "abc"},
        {**STREAM, "source_type": "file", "source": "../etc/passwd"},
        {**STREAM, "confirm_frames": 5, "confirm_window": 3},
        {**STREAM, "zone": [[0.1, 0.1], [0.9, 0.9]]},
        {**STREAM, "name": "   "},
    ]
    for payload in bad:
        assert client.post("/api/cameras", json=payload).status_code == 422, payload


def test_unreachable_stream_goes_offline_and_can_be_disabled(client):
    cam = client.post("/api/cameras", json={**STREAM, "source": "rtsp://127.0.0.1:1/none"}).json()
    offline = wait_for(lambda: next((s for s in client.get("/api/cameras/status").json() if s["id"] == cam["id"] and s["status"] == "offline"), None), 30)
    assert offline and offline["error"]
    client.patch(f"/api/cameras/{cam['id']}", json={"enabled": False})
    state = next(s for s in client.get("/api/cameras/status").json() if s["id"] == cam["id"])
    assert state["status"] == "disabled"
    client.delete(f"/api/cameras/{cam['id']}")


def test_video_file_camera_end_to_end(client, tmp_path):
    clip = tmp_path / "clip.avi"
    make_video(clip)
    up = client.post("/api/cameras/upload-video", files={"file": ("clip.avi", clip.read_bytes(), "video/x-msvideo")})
    assert up.status_code == 201
    filename = up.json()["filename"]

    cam = client.post(
        "/api/cameras",
        json={"name": "Warehouse", "source_type": "file", "source": filename, "confirm_frames": 2, "confirm_window": 3},
    ).json()

    state = wait_for(lambda: next((s for s in client.get("/api/cameras/status").json() if s["id"] == cam["id"] and s["status"] == "fire"), None))
    assert state, "fire should be confirmed after 2 of 3 frames"
    assert state["fps"] > 0 and state["detections"][0]["label"] == "fire"

    frame = client.get(f"/api/cameras/{cam['id']}/frame")
    assert frame.status_code == 200 and frame.headers["content-type"] == "image/jpeg"
    snap = client.get(f"/api/cameras/{cam['id']}/snapshot")
    assert snap.status_code == 200 and snap.content[:2] == b"\xff\xd8"

    incident = wait_for(lambda: next(iter(client.get(f"/api/incidents?camera_id={cam['id']}").json()), None))
    assert incident and incident["camera_name"] == "Warehouse" and incident["source"] == "camera"
    assert incident["raw_url"] and incident["status"] == "new"

    assert client.delete(f"/api/cameras/{cam['id']}").status_code == 204


def test_upload_rejects_non_video(client):
    r = client.post("/api/cameras/upload-video", files={"file": ("x.mp4", b"not a video", "video/mp4")})
    assert r.status_code == 400
    r = client.post("/api/cameras/upload-video", files={"file": ("x.exe", b"MZ", "application/octet-stream")})
    assert r.status_code == 400


def test_events_socket_streams_states(client):
    with client.websocket_connect("/ws/events") as ws:
        msg = ws.receive_json()
    assert "cameras" in msg and "events" in msg


def test_detail_level_is_validated_stored_and_used_by_the_worker(client, tmp_path):
    for bad in (800, 0, "high"):
        r = client.post("/api/cameras", json={**STREAM, "imgsz": bad, "enabled": False})
        assert r.status_code == 422, bad

    clip = tmp_path / "clip.avi"
    make_video(clip)
    fn = client.post("/api/cameras/upload-video", files={"file": ("clip.avi", clip.read_bytes(), "video/x-msvideo")}).json()["filename"]
    cam = client.post("/api/cameras", json={"name": "Detail", "source_type": "file", "source": fn, "imgsz": 960}).json()
    assert cam["imgsz"] == 960

    fake = client.app.state.models._current
    assert wait_for(lambda: 960 in fake.seen_imgsz), "the worker must run the model at the camera's detail level"

    patched = client.patch(f"/api/cameras/{cam['id']}", json={"imgsz": None}).json()  # back to the model default
    assert patched["imgsz"] is None
    client.delete(f"/api/cameras/{cam['id']}")

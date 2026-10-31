import numpy as np
import pytest
from sqlalchemy import create_engine, inspect, text

from app.db.migrate import migrate
from app.schemas.detection import Detection
from app.services.camera_worker import CameraConfig, CameraWorker
from app.services.zones import filter_ignored, filter_smoke
from conftest import FakeDetector

STREAM = {"name": "Office", "source_type": "stream", "source": "rtsp://admin:secret@192.168.1.10/live", "enabled": False}
FRAME = np.full((72, 96, 3), 120, np.uint8)


def det(label="smoke", conf=0.5, box=(0.1, 0.1, 0.5, 0.5)):
    return Detection(label=label, confidence=conf, box=box)


# ------------------------------------------------------------------ pure filters
def test_a_box_mostly_inside_an_ignored_area_is_dropped_but_a_neighbour_survives():
    area = (0.0, 0.0, 0.6, 0.6)  # where the fan's shadow falls
    shadow = det(box=(0.1, 0.1, 0.5, 0.5))
    elsewhere = det(box=(0.7, 0.7, 0.9, 0.9))
    assert filter_ignored([shadow, elsewhere], [area]) == [elsewhere]


def test_a_box_that_only_clips_the_ignored_area_is_kept():
    """A real fire next to the shadow must not vanish just because their boxes touch."""
    area = (0.0, 0.0, 0.3, 0.3)
    fire = det("fire", 0.8, box=(0.25, 0.25, 0.75, 0.75))  # ~1% of this box is inside the area
    assert filter_ignored([fire], [area]) == [fire]


def test_no_areas_means_nothing_is_ignored():
    d = det()
    assert filter_ignored([d], None) == [d] and filter_ignored([d], []) == [d]


def test_smoke_can_be_switched_off_without_touching_fire():
    s, f = det("smoke", 0.9), det("fire", 0.9)
    assert filter_smoke([s, f], detect_smoke=False, min_confidence=0.0) == [f]


def test_a_stricter_smoke_bar_never_applies_to_fire():
    weak_smoke, weak_fire = det("smoke", 0.5), det("fire", 0.5)
    assert filter_smoke([weak_smoke, weak_fire], True, 0.65) == [weak_fire]
    assert filter_smoke([det("smoke", 0.7)], True, 0.65)


# ------------------------------------------------------------------ the worker applies them
class _Cam:
    id, name, source_type, source = 1, "cam", "file", "x.avi"
    confidence, confirm_frames, confirm_window, cooldown, imgsz, zone = 0.4, 1, 1, 30, None, None
    detect_smoke, smoke_confidence, ignore_areas = True, None, None


def worker_state(detector, **overrides):
    cam = _Cam()
    for k, v in overrides.items():
        setattr(cam, k, v)
    w = CameraWorker(CameraConfig.from_model(cam), detector, lambda *_: None)
    w._process(FRAME)
    return w.state()


def test_effective_smoke_bar_is_never_below_the_general_confidence():
    assert CameraConfig.from_model(_Cam()).smoke_confidence == 0.4
    cam = _Cam()
    cam.smoke_confidence = 0.2  # stale value left over after the general bar was raised
    assert CameraConfig.from_model(cam).smoke_confidence == 0.4
    cam.smoke_confidence = 0.7
    assert CameraConfig.from_model(cam).smoke_confidence == 0.7


def test_worker_ignores_shadow_smoke_in_an_ignored_area():
    shadow = FakeDetector("smoke", confidence=0.6)  # box (0.1, 0.1, 0.6, 0.6)
    assert worker_state(shadow).detections  # without the area it alarms, as the user saw
    assert not worker_state(shadow, ignore_areas=[[0.0, 0.0, 0.7, 0.7]]).detections


def test_worker_with_smoke_off_stays_quiet_on_smoke_but_still_reports_fire():
    assert not worker_state(FakeDetector("smoke", confidence=0.6), detect_smoke=False).detections
    assert worker_state(FakeDetector("fire", confidence=0.6), detect_smoke=False).detections


def test_worker_holds_smoke_to_the_stricter_bar():
    smoke = FakeDetector("smoke", confidence=0.6)
    assert worker_state(smoke).detections
    assert not worker_state(smoke, smoke_confidence=0.75).detections


# ------------------------------------------------------------------ API
def test_camera_api_round_trips_the_new_settings(client):
    body = {**STREAM, "detect_smoke": False, "smoke_confidence": 0.7, "ignore_areas": [[0.1, 0.1, 0.5, 0.4]]}
    cam = client.post("/api/cameras", json=body).json()
    assert cam["detect_smoke"] is False and cam["smoke_confidence"] == 0.7 and cam["ignore_areas"] == [[0.1, 0.1, 0.5, 0.4]]

    patched = client.patch(f"/api/cameras/{cam['id']}", json={"ignore_areas": [[0.1, 0.1, 0.5, 0.4], [0.6, 0.6, 0.9, 0.9]], "smoke_confidence": None})
    assert patched.status_code == 200
    out = patched.json()
    assert len(out["ignore_areas"]) == 2 and out["smoke_confidence"] is None and out["detect_smoke"] is False
    assert client.patch(f"/api/cameras/{cam['id']}", json={"ignore_areas": []}).json()["ignore_areas"] is None
    client.delete(f"/api/cameras/{cam['id']}")


@pytest.mark.parametrize("areas", [[[0.5, 0.1, 0.2, 0.4]], [[0.1, 0.1, 1.2, 0.4]], [[0.1, 0.1, 0.1, 0.4]], [[0.0, 0.0, 0.1, 0.1]] * 17])
def test_camera_api_rejects_malformed_ignored_areas(client, areas):
    assert client.post("/api/cameras", json={**STREAM, "ignore_areas": areas}).status_code == 422


def test_old_cameras_gain_the_smoke_columns_with_smoke_detection_still_on(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'cam.db'}")
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE cameras (id INTEGER PRIMARY KEY, name VARCHAR(80), source_type VARCHAR(16), source VARCHAR(512), "
                          "enabled BOOLEAN, confidence FLOAT, confirm_frames INTEGER, confirm_window INTEGER, cooldown INTEGER, zone JSON, created_at DATETIME)"))
        conn.execute(text("INSERT INTO cameras (name, source_type, source, enabled, confidence, confirm_frames, confirm_window, cooldown) "
                          "VALUES ('Old', 'device', '0', 1, 0.4, 3, 5, 30)"))
    migrate(engine)
    migrate(engine)
    assert {"detect_smoke", "smoke_confidence", "ignore_areas"} <= {c["name"] for c in inspect(engine).get_columns("cameras")}
    with engine.connect() as conn:
        assert conn.execute(text("SELECT detect_smoke, smoke_confidence, ignore_areas FROM cameras")).one() == (1, None, None)

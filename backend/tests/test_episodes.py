import uuid

import numpy as np
import pytest
from sqlalchemy import select

from app.config import settings
from app.db.models import Incident
from app.db.session import SessionLocal, init_db
from app.schemas.detection import Detection
from app.services import episodes as episodes_module
from app.services.confirmation import TrackResult
from app.services.episodes import EpisodeRecorder

FRAME = np.full((48, 64, 3), 100, np.uint8)


def det(conf=0.6, label="fire"):
    return Detection(label=label, confidence=conf, box=(0.1, 0.1, 0.6, 0.6))


def active(conf=0.6, label="fire"):
    d = det(conf, label)
    return TrackResult(active={label}, shown=[d], current=[d])


def held():
    """Alarm still on, but nothing seen in this frame."""
    return TrackResult(active={"fire"}, shown=[det().model_copy(update={"held": True})], current=[])


def ended():
    return TrackResult(ended={"fire"})


@pytest.fixture()
def rec():
    init_db()
    events: list[tuple[str, dict]] = []
    name = f"cam-{uuid.uuid4().hex[:8]}"  # unique, so tests sharing one database never see each other's rows
    recorder = EpisodeRecorder("camera", 1, name, merge_window=30, publish=lambda kind, data: events.append((kind, data)))
    recorder.events, recorder.name = events, name  # type: ignore[attr-defined]
    return recorder


def incidents(name):
    with SessionLocal() as db:
        return list(db.scalars(select(Incident).where(Incident.camera_name == name).order_by(Incident.id)))


def test_a_continuous_hazard_is_one_incident_whose_end_keeps_moving(rec):
    rec.process(FRAME, active(), now=0)
    for t in range(1, 25):
        rec.process(FRAME, active(), now=float(t))  # 24 more seconds of the same fire
    rows = incidents(rec.name)
    assert len(rows) == 1
    assert rows[0].ended_at > rows[0].created_at  # the incident records that it lasted, not only that it began
    assert [k for k, _ in rec.events].count("incident") == 1


def test_a_hazard_that_comes_back_inside_the_merge_window_extends_the_same_incident(rec):
    """The old behaviour dropped this one silently, which is why incidents seemed to go missing."""
    rec.process(FRAME, active(), now=0)
    rec.process(FRAME, ended(), now=4)
    rec.process(FRAME, active(), now=20)  # back after 16 s: inside the 30 s merge window
    rows = incidents(rec.name)
    assert len(rows) == 1


def test_a_hazard_after_the_merge_window_is_a_new_incident(rec):
    rec.process(FRAME, active(), now=0)
    rec.process(FRAME, ended(), now=4)
    rec.process(FRAME, active(), now=100)
    assert len(incidents(rec.name)) == 2


def test_a_missed_frame_does_not_lose_or_duplicate_the_incident(rec):
    rec.process(FRAME, active(), now=0)
    rec.process(FRAME, held(), now=1)  # alarm still on, nothing fresh this frame
    rec.process(FRAME, active(), now=2)
    assert len(incidents(rec.name)) == 1


def test_a_clearly_better_frame_replaces_the_snapshot_and_peak(rec):
    rec.process(np.full((48, 64, 3), 30, np.uint8), active(0.45), now=0)
    before = incidents(rec.name)[0]
    name = before.snapshot
    first_bytes = (settings.snapshot_dir / name).read_bytes()

    rec.process(np.full((48, 64, 3), 200, np.uint8), active(0.88), now=5)  # much more confident, a better picture
    after = incidents(rec.name)[0]
    assert after.confidence == pytest.approx(0.88)
    assert (settings.snapshot_dir / name).read_bytes() != first_bytes
    assert "incident_update" in [k for k, _ in rec.events]


def test_a_failed_write_is_retried_on_the_next_frame_instead_of_lost(rec, monkeypatch):
    real = episodes_module.log_incident
    calls = {"n": 0}

    def flaky(*a, **k):
        calls["n"] += 1
        if calls["n"] == 1:
            raise OSError("disk hiccup")
        return real(*a, **k)

    monkeypatch.setattr(episodes_module, "log_incident", flaky)
    rec.process(FRAME, active(), now=0)  # fails: no incident yet, and nothing is "used up"
    assert incidents(rec.name) == []
    rec.process(FRAME, active(), now=1)  # the very next frame tries again
    assert len(incidents(rec.name)) == 1


def test_closing_marks_the_end_so_it_stops_looking_ongoing(rec):
    rec.process(FRAME, active(), now=0)
    rec.close_all()
    row = incidents(rec.name)[0]
    assert row.ended_at is not None
    rec.close_all()  # idempotent
    assert len(incidents(rec.name)) == 1


def both(fire_conf=0.6, smoke_conf=0.5):
    fire, smoke = det(fire_conf, "fire"), det(smoke_conf, "smoke")
    return TrackResult(active={"fire", "smoke"}, shown=[fire, smoke], current=[fire, smoke])


def test_a_flame_and_its_smoke_are_one_incident_filed_as_fire(rec):
    """A lighter shows a flame AND smoke at once. That is one event, so it must be one entry in the list."""
    rec.process(FRAME, both(), now=0)
    rows = incidents(rec.name)
    assert len(rows) == 1
    assert rows[0].label == "fire" and rows[0].confidence == pytest.approx(0.6)  # the fire's confidence, not the smoke's
    assert {d["label"] for d in rows[0].detections} == {"fire", "smoke"}  # the picture shows both boxes
    assert [k for k, _ in rec.events].count("incident") == 1


def test_smoke_first_then_flame_is_one_incident_upgraded_to_fire(rec):
    rec.process(FRAME, active(0.6, "smoke"), now=0)
    rec.process(FRAME, both(fire_conf=0.55, smoke_conf=0.6), now=1)  # flame appears a second later
    rows = incidents(rec.name)
    assert len(rows) == 1 and rows[0].label == "fire"
    assert any(k == "incident_update" and d["label"] == "fire" for k, d in rec.events)


def test_an_incident_is_never_downgraded_from_fire_to_smoke(rec):
    rec.process(FRAME, both(), now=0)
    rec.process(FRAME, active(0.95, "smoke"), now=10)  # only smoke left, and very confident
    assert incidents(rec.name)[0].label == "fire"


def test_one_lighter_flick_with_flickering_labels_stays_one_incident(rec):
    """Fire and smoke each appear, vanish and return while the lighter is held up: still ONE incident."""
    frames = [both(), active(0.5, "smoke"), both(0.7, 0.55), held(), active(0.62, "fire"), both(0.5, 0.45), active(0.58, "smoke")]
    for t, result in enumerate(frames):
        rec.process(FRAME, result, now=float(t))
    rec.process(FRAME, TrackResult(ended={"fire", "smoke"}), now=10)
    rec.process(FRAME, both(0.65, 0.5), now=22)  # lighter lifted again after 12 s, inside the 30 s merge window
    rows = incidents(rec.name)
    assert len(rows) == 1
    assert rows[0].ended_at > rows[0].created_at


def test_the_best_picture_replaces_the_snapshot_so_the_list_shows_one_image(rec):
    rec.process(np.full((48, 64, 3), 30, np.uint8), both(0.45, 0.4), now=0)
    name = incidents(rec.name)[0].snapshot
    first = (settings.snapshot_dir / name).read_bytes()
    rec.process(np.full((48, 64, 3), 220, np.uint8), both(0.9, 0.7), now=6)
    row = incidents(rec.name)[0]
    assert len(incidents(rec.name)) == 1 and row.snapshot == name
    assert row.confidence == pytest.approx(0.9)
    assert (settings.snapshot_dir / name).read_bytes() != first


def test_a_new_event_after_the_merge_window_is_still_a_separate_incident(rec):
    rec.process(FRAME, both(), now=0)
    rec.process(FRAME, TrackResult(ended={"fire", "smoke"}), now=5)
    rec.process(FRAME, both(), now=200)
    assert len(incidents(rec.name)) == 2

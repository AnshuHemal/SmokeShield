import pytest

from app.schemas.detection import Detection
from app.services.confirmation import AlarmTracker
from app.services.zones import filter_by_zone, point_in_polygon


def det(label="fire", conf=0.5, box=(0.1, 0.1, 0.3, 0.3)):
    return Detection(label=label, confidence=conf, box=box)


def run(tracker, frames, gap=0.5, start=0.0):
    """Feed frames (lists of detections) one `gap` seconds apart and return every result."""
    return [tracker.update(f, start + i * gap) for i, f in enumerate(frames)]


# ---------------------------------------------------------------- confirmation
def test_isolated_glitches_never_alarm_but_are_reported_as_pending():
    t = AlarmTracker(required=3, window=5, hold_s=3, instant_conf=0.9)
    results = run(t, [[det()], [], [], [det()], [], [], [det()]])
    assert all(not r.active for r in results)
    assert [bool(r.pending) for r in results] == [True, False, False, True, False, False, True]


def test_sustained_hazard_confirms_after_required_hits():
    t = AlarmTracker(required=3, window=5, hold_s=3, instant_conf=0.9)
    r = run(t, [[det()], [det()], [det()]])
    assert [bool(x.active) for x in r] == [False, False, True]
    assert r[2].current and not r[2].shown[0].held


def test_one_very_confident_detection_confirms_at_once():
    t = AlarmTracker(required=3, window=5, hold_s=3, instant_conf=0.75)
    assert t.update([det(conf=0.6)], 0).active == set()  # ordinary: waits for N frames
    t2 = AlarmTracker(required=3, window=5, hold_s=3, instant_conf=0.75)
    assert t2.update([det(conf=0.8)], 0).active == {"fire"}  # obvious fire: no waiting


def test_low_hit_rate_flame_confirms_with_a_lenient_setting():
    """A small flame found in ~1 of 3 frames still confirms with 2-of-4, which is what the close-range preset uses."""
    t = AlarmTracker(required=2, window=4, hold_s=3, instant_conf=0.9)
    r = run(t, [[det()], [], [], [det()]])
    assert r[-1].active == {"fire"}


# ---------------------------------------------------------------- hysteresis: no blinking
def test_alarm_survives_missed_frames_and_shows_the_last_known_box():
    t = AlarmTracker(required=2, window=3, hold_s=3, instant_conf=0.9)
    run(t, [[det()], [det()]])  # confirmed
    r = t.update([], 2.5)  # 1.5 s of nothing, still inside the hold
    assert r.active == {"fire"}
    assert r.current == []  # nothing fresh...
    assert len(r.shown) == 1 and r.shown[0].held is True  # ...but the box does not vanish


def test_alarm_ends_after_the_hold_and_then_needs_fresh_evidence():
    t = AlarmTracker(required=2, window=3, hold_s=3, instant_conf=0.9)
    run(t, [[det()], [det()]])
    assert t.update([], 3.0).active == {"fire"}  # inside hold (last seen at 1.0 → 2.0 s ago)
    ended = t.update([], 6.0)
    assert ended.active == set() and ended.ended == {"fire"}
    assert t.update([det()], 6.5).active == set()  # a single hit is not enough after an alarm ended
    assert t.update([det()], 7.0).active == {"fire"}


def test_flickering_flame_is_one_continuous_alarm():
    """Detected in only ~40% of frames, yet the alarm must not drop out once it has started."""
    t = AlarmTracker(required=2, window=4, hold_s=3, instant_conf=0.9)
    pattern = [1, 0, 1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 1]
    results = run(t, [[det()] if hit else [] for hit in pattern], gap=0.5)
    first = next(i for i, r in enumerate(results) if r.active)
    assert all(r.active for r in results[first:]), "alarm blinked off while the flame was still flickering"
    assert not any(r.ended for r in results)


def test_hold_stretches_for_slow_cameras():
    """At 2 s per frame (big inference size, busy server) three frame intervals is 6 s, longer than hold_s."""
    t = AlarmTracker(required=1, window=1, hold_s=3, instant_conf=0.9)
    run(t, [[det()], [det()], [det()]], gap=2.0)  # last sighting at t = 4 s
    assert t.update([], 7.0).active == {"fire"}  # 3 s of silence: a fixed 3 s hold would be about to expire
    assert t.update([], 11.0).active == {"fire"}  # 7 s of silence: still held, as it is under 3 frame intervals
    assert t.update([], 40.0).ended == {"fire"}  # but not forever


def test_one_long_stall_cannot_stretch_the_hold_indefinitely():
    t = AlarmTracker(required=1, window=1, hold_s=3, instant_conf=0.9)
    run(t, [[det()]] * 4, gap=0.5)  # healthy 2 fps
    # the camera froze for ten minutes: the alarm must end on that first update, not be held for minutes
    assert t.update([], 600.0).ended == {"fire"}


def test_labels_are_independent():
    t = AlarmTracker(required=2, window=3, hold_s=3, instant_conf=0.9)
    t.update([det("smoke")], 0)
    r = t.update([det("smoke"), det("fire")], 0.5)
    assert r.active == {"smoke"} and [d.label for d in r.pending] == ["fire"]


def test_required_is_clamped_to_window_and_reset_reports_active_labels():
    assert AlarmTracker(required=9, window=4).required == 4
    t = AlarmTracker(required=1, window=1, hold_s=3, instant_conf=0.9)
    t.update([det()], 0)
    assert t.reset() == {"fire"} and t.update([], 0.1).active == set()


# ---------------------------------------------------------------- zones (unchanged behaviour)
SQUARE = [(0.0, 0.0), (0.5, 0.0), (0.5, 0.5), (0.0, 0.5)]


def test_point_in_polygon():
    assert point_in_polygon(0.25, 0.25, SQUARE)
    assert not point_in_polygon(0.75, 0.75, SQUARE)


def test_zone_filters_by_box_centre():
    inside, outside = det(box=(0.1, 0.1, 0.3, 0.3)), det(box=(0.6, 0.6, 0.9, 0.9))
    assert filter_by_zone([inside, outside], SQUARE) == [inside]
    assert len(filter_by_zone([inside, outside], None)) == 2  # no zone = whole frame


@pytest.mark.parametrize("hold", [0.5, 3, 10])
def test_hold_never_drops_a_label_that_keeps_being_seen(hold):
    t = AlarmTracker(required=1, window=1, hold_s=hold, instant_conf=0.9)
    assert all(r.active for r in run(t, [[det()]] * 20, gap=0.4))

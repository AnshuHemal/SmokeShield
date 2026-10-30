from app.schemas.detection import Detection
from app.services.confirmation import TemporalConfirmer
from app.services.zones import filter_by_zone, point_in_polygon


def det(label="fire", box=(0.1, 0.1, 0.3, 0.3)):
    return Detection(label=label, confidence=0.8, box=box)


def test_single_frame_glitch_never_confirms():
    c = TemporalConfirmer(required=3, window=5)
    seq = [[det()], [], [], [det()], [], [], [det()]]  # isolated hits, never 3 in 5
    assert all(not c.update(frame) for frame in seq)


def test_sustained_hazard_confirms_after_required_frames():
    c = TemporalConfirmer(required=3, window=5)
    assert c.update([det()]) == set()
    assert c.update([det()]) == set()
    assert c.update([det()]) == {"fire"}


def test_confirmation_expires_when_hazard_leaves():
    c = TemporalConfirmer(required=2, window=3)
    c.update([det()]), c.update([det()])
    assert c.update([]) == {"fire"}  # 2 of last 3
    assert c.update([]) == set()


def test_labels_are_tracked_independently():
    c = TemporalConfirmer(required=2, window=3)
    c.update([det("smoke")])
    assert c.update([det("smoke"), det("fire")]) == {"smoke"}


def test_required_is_clamped_to_window():
    assert TemporalConfirmer(required=9, window=4).required == 4


SQUARE = [(0.0, 0.0), (0.5, 0.0), (0.5, 0.5), (0.0, 0.5)]


def test_point_in_polygon():
    assert point_in_polygon(0.25, 0.25, SQUARE)
    assert not point_in_polygon(0.75, 0.75, SQUARE)


def test_zone_filters_by_box_centre():
    inside, outside = det(box=(0.1, 0.1, 0.3, 0.3)), det(box=(0.6, 0.6, 0.9, 0.9))
    assert filter_by_zone([inside, outside], SQUARE) == [inside]
    assert len(filter_by_zone([inside, outside], None)) == 2  # no zone = whole frame

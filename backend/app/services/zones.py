from ..schemas.detection import Detection

Zone = list[tuple[float, float]]
Area = tuple[float, float, float, float]  # normalised x1, y1, x2, y2

IGNORE_OVERLAP = 0.5  # a box with at least this share of its area inside an ignored area is dropped


def point_in_polygon(x: float, y: float, polygon: Zone) -> bool:
    """Ray casting; points on an edge may fall either way, which is fine for detection centres."""
    inside = False
    j = len(polygon) - 1
    for i, (xi, yi) in enumerate(polygon):
        xj, yj = polygon[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def filter_by_zone(detections: list[Detection], zone: Zone | None) -> list[Detection]:
    """Keep only detections whose box centre lies inside the monitored zone (no zone = whole frame)."""
    if not zone or len(zone) < 3:
        return detections
    return [
        d
        for d in detections
        if point_in_polygon((d.box[0] + d.box[2]) / 2, (d.box[1] + d.box[3]) / 2, zone)
    ]


def _share_inside(box: tuple[float, float, float, float], area: Area) -> float:
    """Fraction of the box that lies inside the area."""
    w = min(box[2], area[2]) - max(box[0], area[0])
    h = min(box[3], area[3]) - max(box[1], area[1])
    size = (box[2] - box[0]) * (box[3] - box[1])
    return (w * h) / size if w > 0 and h > 0 and size > 0 else 0.0


def filter_ignored(detections: list[Detection], areas: list[Area] | None) -> list[Detection]:
    """Drop detections that sit in an area the user marked as a known false-alarm source (a fan's shadow, a window)."""
    if not areas:
        return detections
    return [d for d in detections if not any(_share_inside(d.box, a) >= IGNORE_OVERLAP for a in areas)]


def filter_smoke(detections: list[Detection], detect_smoke: bool, min_confidence: float) -> list[Detection]:
    """Smoke is the noisiest class (shadows, steam, dust all look like it), so it can be switched off or held to a higher bar."""
    if not detect_smoke:
        return [d for d in detections if d.label != "smoke"]
    return [d for d in detections if d.label != "smoke" or d.confidence >= min_confidence]

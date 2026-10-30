from ..schemas.detection import Detection

Zone = list[tuple[float, float]]


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

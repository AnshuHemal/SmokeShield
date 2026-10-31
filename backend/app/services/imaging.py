"""Frame encode / decode / drawing helpers (no model or web dependencies)."""

import base64
import math

import cv2
import numpy as np

from ..schemas.detection import Detection

COLORS = {"fire": (40, 90, 255), "smoke": (200, 200, 200)}  # BGR
ZONE_COLOR = (255, 200, 0)


def decode_image(data: bytes) -> np.ndarray:
    frame = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if frame is None:
        raise ValueError("Could not decode image")
    return frame


def encode_jpeg(frame: np.ndarray, quality: int = 85) -> bytes:
    ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, quality])
    if not ok:
        raise ValueError("JPEG encoding failed")
    return buf.tobytes()


def data_url(jpeg: bytes) -> str:
    return "data:image/jpeg;base64," + base64.b64encode(jpeg).decode()


PENDING_COLOR = (0, 190, 255)  # amber (BGR)


def _dashed_line(img: np.ndarray, a: tuple[int, int], b: tuple[int, int], color, thickness: int, dash: int = 10, gap: int = 7) -> None:
    length = math.hypot(b[0] - a[0], b[1] - a[1])
    if length == 0:
        return
    dx, dy = (b[0] - a[0]) / length, (b[1] - a[1]) / length
    pos = 0.0
    while pos < length:
        end = min(pos + dash, length)
        cv2.line(img, (int(a[0] + dx * pos), int(a[1] + dy * pos)), (int(a[0] + dx * end), int(a[1] + dy * end)), color, thickness, cv2.LINE_AA)
        pos += dash + gap


def _dashed_rect(img: np.ndarray, p1: tuple[int, int], p2: tuple[int, int], color, thickness: int) -> None:
    (x1, y1), (x2, y2) = p1, p2
    for a, b in (((x1, y1), (x2, y1)), ((x2, y1), (x2, y2)), ((x2, y2), (x1, y2)), ((x1, y2), (x1, y1))):
        _dashed_line(img, a, b, color, thickness)


def _tag(img: np.ndarray, text: str, x1: int, y1: int, color, text_color=(0, 0, 0)) -> None:
    (tw, th), _ = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, 0.55, 1)
    cv2.rectangle(img, (x1, max(0, y1 - th - 8)), (x1 + tw + 8, y1), color, -1)
    cv2.putText(img, text, (x1 + 4, max(th, y1 - 5)), cv2.FONT_HERSHEY_SIMPLEX, 0.55, text_color, 1, cv2.LINE_AA)


def annotate(frame: np.ndarray, detections: list[Detection], pending: list[Detection] | None = None) -> np.ndarray:
    """Solid box = confirmed now. Dashed box = last known position, held briefly after a missed frame.
    Thin amber dashed box = seen but not confirmed yet ("possible")."""
    img = frame.copy()
    h, w = img.shape[:2]

    def px(d: Detection) -> tuple[tuple[int, int], tuple[int, int]]:
        return (int(d.box[0] * w), int(d.box[1] * h)), (int(d.box[2] * w), int(d.box[3] * h))

    for d in pending or []:
        p1, p2 = px(d)
        _dashed_rect(img, p1, p2, PENDING_COLOR, 1)
        _tag(img, f"POSSIBLE {d.label.upper()} {d.confidence:.0%}", p1[0], p1[1], PENDING_COLOR)
    for d in detections:
        p1, p2 = px(d)
        color = COLORS[d.label]
        if d.held:
            _dashed_rect(img, p1, p2, color, 2)
        else:
            cv2.rectangle(img, p1, p2, color, 2)
            _tag(img, f"{d.label.upper()} {d.confidence:.0%}", p1[0], p1[1], color)
    return img


def draw_zone(frame: np.ndarray, zone: list[tuple[float, float]] | None) -> np.ndarray:
    """Dim everything outside the monitored zone and outline the zone."""
    if not zone or len(zone) < 3:
        return frame
    h, w = frame.shape[:2]
    pts = np.array([[int(x * w), int(y * h)] for x, y in zone], np.int32)
    mask = np.zeros((h, w), np.uint8)
    cv2.fillPoly(mask, [pts], 255)
    dimmed = (frame * 0.4).astype(np.uint8)
    out = np.where(mask[..., None] > 0, frame, dimmed)
    cv2.polylines(out, [pts], True, ZONE_COLOR, 2, cv2.LINE_AA)
    return out


def resize_to_width(frame: np.ndarray, width: int) -> np.ndarray:
    h, w = frame.shape[:2]
    if w <= width:
        return frame
    return cv2.resize(frame, (width, int(h * width / w)), interpolation=cv2.INTER_AREA)

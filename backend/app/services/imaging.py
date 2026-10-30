"""Frame encode / decode / drawing helpers (no model or web dependencies)."""

import base64

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


def annotate(frame: np.ndarray, detections: list[Detection]) -> np.ndarray:
    img = frame.copy()
    h, w = img.shape[:2]
    for d in detections:
        x1, y1, x2, y2 = (int(d.box[0] * w), int(d.box[1] * h), int(d.box[2] * w), int(d.box[3] * h))
        color = COLORS[d.label]
        cv2.rectangle(img, (x1, y1), (x2, y2), color, 2)
        text = f"{d.label.upper()} {d.confidence:.0%}"
        (tw, th), _ = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, 0.55, 1)
        cv2.rectangle(img, (x1, max(0, y1 - th - 8)), (x1 + tw + 8, y1), color, -1)
        cv2.putText(img, text, (x1 + 4, max(th, y1 - 5)), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 0, 0), 1, cv2.LINE_AA)
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

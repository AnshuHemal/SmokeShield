"""One background thread per enabled camera: read frames, detect, confirm, log incidents."""

import logging
import os
import sys
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass

import cv2
import numpy as np

from ..config import settings
from ..schemas.camera import CameraState
from ..schemas.detection import Detection
from .confirmation import TemporalConfirmer
from .detector import DetectorLike, timed_predict
from .imaging import annotate, draw_zone, encode_jpeg, resize_to_width
from .zones import Zone, filter_by_zone

log = logging.getLogger("smokeshield.camera")

# RTSP over TCP is far more reliable than UDP across routers / Wi-Fi.
os.environ.setdefault("OPENCV_FFMPEG_CAPTURE_OPTIONS", "rtsp_transport;tcp")

IncidentCallback = Callable[["CameraConfig", np.ndarray, list[Detection]], None]


@dataclass(frozen=True)
class CameraConfig:
    """Immutable copy of a Camera row, so a worker never touches a live ORM object."""

    id: int
    name: str
    source_type: str
    source: str
    confidence: float
    confirm_frames: int
    confirm_window: int
    cooldown: int
    zone: Zone | None

    @classmethod
    def from_model(cls, cam) -> "CameraConfig":
        zone = [(float(x), float(y)) for x, y in cam.zone] if cam.zone else None
        return cls(cam.id, cam.name, cam.source_type, cam.source, cam.confidence,
                   cam.confirm_frames, cam.confirm_window, cam.cooldown, zone)


def open_capture(source_type: str, source: str) -> cv2.VideoCapture | None:
    """Open a video source; returns None when it cannot be opened."""
    if source_type == "file":
        path = settings.video_dir / source
        return cv2.VideoCapture(str(path)) if path.exists() else None
    if source_type == "device":
        backend = cv2.CAP_DSHOW if sys.platform == "win32" else cv2.CAP_ANY
        return cv2.VideoCapture(int(source), backend)
    ms = settings.stream_timeout_ms
    try:
        return cv2.VideoCapture(
            source, cv2.CAP_FFMPEG, [cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, ms, cv2.CAP_PROP_READ_TIMEOUT_MSEC, ms]
        )
    except (TypeError, cv2.error):  # older OpenCV without the params overload
        return cv2.VideoCapture(source)


def grab_one_frame(source_type: str, source: str) -> np.ndarray | None:
    """Blocking single-frame grab (used for zone-editor previews of cameras that are not running)."""
    cap = open_capture(source_type, source)
    if cap is None or not cap.isOpened():
        return None
    try:
        for _ in range(5):  # first frames from some cameras are black / partial
            ok, frame = cap.read()
        return frame if ok else None
    finally:
        cap.release()


class CameraWorker(threading.Thread):
    def __init__(self, cfg: CameraConfig, detector: DetectorLike, on_incident: IncidentCallback) -> None:
        super().__init__(name=f"camera-{cfg.id}", daemon=True)
        self.cfg = cfg
        self._detector = detector
        self._on_incident = on_incident
        self._halt = threading.Event()
        self._lock = threading.Lock()
        self._state = CameraState(id=cfg.id, status="starting")
        self._jpeg: bytes | None = None
        self._frame: np.ndarray | None = None
        self._confirmer = TemporalConfirmer(cfg.confirm_frames, cfg.confirm_window)
        self._last_incident = -1e9
        self._last_ts: float | None = None
        self._fps = 0.0

    # ----- public, thread-safe accessors -----
    def state(self) -> CameraState:
        with self._lock:
            return self._state.model_copy()

    def latest_jpeg(self) -> bytes | None:
        with self._lock:
            return self._jpeg

    def latest_raw_jpeg(self) -> bytes | None:
        with self._lock:
            frame = self._frame
        return encode_jpeg(frame, 90) if frame is not None else None

    def stop(self) -> None:
        self._halt.set()

    # ----- thread body -----
    def run(self) -> None:
        backoff = 1.0
        while not self._halt.is_set():
            cap = None
            try:
                cap = open_capture(self.cfg.source_type, self.cfg.source)
                if cap is None or not cap.isOpened():
                    raise ConnectionError("Cannot open video source")
                backoff = 1.0
                self._loop(cap)
            except Exception as exc:  # noqa: BLE001 - a camera must never kill the process
                log.warning("camera %s (%s): %s", self.cfg.id, self.cfg.name, exc)
                self._go_offline(str(exc))
            finally:
                if cap is not None:
                    cap.release()
            if self._halt.wait(backoff):
                break
            backoff = min(backoff * 2, 30.0)  # exponential reconnect back-off, max 30 s

    def _loop(self, cap: cv2.VideoCapture) -> None:
        is_file = self.cfg.source_type == "file"
        src_fps = (cap.get(cv2.CAP_PROP_FPS) or 25.0) if is_file else 0.0
        interval = 1.0 / settings.worker_fps
        next_due = 0.0
        rewinds = 0
        while not self._halt.is_set():
            # grab() is cheap; only decode (retrieve) the frames we will actually analyse,
            # which also drains the network buffer so live streams do not lag behind.
            if not cap.grab():
                if is_file and rewinds < 3:
                    cap.set(cv2.CAP_PROP_POS_FRAMES, 0)  # loop the clip
                    rewinds += 1
                    continue
                raise ConnectionError("Video file cannot be decoded" if is_file else "Stream lost")
            rewinds = 0
            if is_file and self._halt.wait(1.0 / src_fps):  # play files at real-time speed
                return
            now = time.monotonic()
            if now < next_due:
                continue
            ok, frame = cap.retrieve()
            if not ok or frame is None:
                continue
            next_due = now + interval
            try:
                self._process(frame)
            except Exception:  # noqa: BLE001 - one bad inference must not drop the camera
                log.exception("camera %s: processing failed", self.cfg.id)

    def _process(self, frame: np.ndarray) -> None:
        cfg = self.cfg
        dets, latency = timed_predict(self._detector, frame, cfg.confidence)
        dets = filter_by_zone(dets, cfg.zone)
        confirmed = self._confirmer.update(dets)
        shown = [d for d in dets if d.label in confirmed]
        status = "fire" if "fire" in confirmed else "smoke" if "smoke" in confirmed else "ok"

        vis = annotate(draw_zone(frame, cfg.zone), shown)
        jpeg = encode_jpeg(resize_to_width(vis, 960), 72)

        wall = time.time()
        if self._last_ts is not None:
            inst = 1.0 / max(wall - self._last_ts, 1e-3)
            self._fps = inst if self._fps == 0 else self._fps * 0.8 + inst * 0.2
        self._last_ts = wall

        with self._lock:
            self._jpeg = jpeg
            self._frame = frame
            self._state = CameraState(
                id=cfg.id, status=status, fps=round(self._fps, 1), latency_ms=latency,
                detections=shown, last_frame_at=wall,
            )

        mono = time.monotonic()
        if shown and mono - self._last_incident >= cfg.cooldown:
            self._last_incident = mono
            try:
                self._on_incident(cfg, frame, shown)
            except Exception:  # noqa: BLE001
                log.exception("camera %s: could not log incident", cfg.id)

    def _go_offline(self, message: str) -> None:
        self._confirmer.reset()
        self._fps = 0.0
        self._last_ts = None
        with self._lock:
            self._jpeg = None
            self._state = CameraState(id=self.cfg.id, status="offline", error=message)

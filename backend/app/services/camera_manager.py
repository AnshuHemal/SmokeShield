"""Owns every CameraWorker and the live event feed that the dashboard subscribes to."""

import logging
import threading
from collections import deque

import numpy as np
from sqlalchemy import select

from ..db.models import Camera
from ..db.session import SessionLocal
from ..schemas.camera import CameraState
from ..schemas.detection import Detection
from .camera_worker import CameraConfig, CameraWorker
from .detector import DetectorLike
from .incidents import log_incident

log = logging.getLogger("smokeshield.manager")

ONLINE = {"ok", "smoke", "fire"}


class CameraManager:
    def __init__(self, detector: DetectorLike) -> None:
        self._detector = detector
        self._workers: dict[int, CameraWorker] = {}
        self._enabled: dict[int, bool] = {}  # every known camera id -> enabled flag
        self._events: deque[dict] = deque(maxlen=100)
        self._seq = 0
        self._lock = threading.RLock()

    # ----- lifecycle -----
    def start(self) -> None:
        with SessionLocal() as db:
            for cam in db.scalars(select(Camera)):
                self.apply(cam)

    def stop_all(self) -> None:
        with self._lock:
            workers = list(self._workers.values())
            self._workers.clear()
        for w in workers:
            w.stop()
        for w in workers:
            w.join(timeout=3)

    def apply(self, cam: Camera) -> None:
        """(Re)start or stop the worker so it matches the camera's stored configuration."""
        with self._lock:
            old = self._workers.pop(cam.id, None)
            self._enabled[cam.id] = cam.enabled
        self._halt(old)  # join outside the lock: a worker may be waiting on it inside _on_incident
        if cam.enabled and self._detector.loaded:
            worker = CameraWorker(CameraConfig.from_model(cam), self._detector, self._on_incident)
            with self._lock:
                self._workers[cam.id] = worker
            worker.start()

    def remove(self, camera_id: int) -> None:
        with self._lock:
            old = self._workers.pop(camera_id, None)
            self._enabled.pop(camera_id, None)
        self._halt(old)

    @staticmethod
    def _halt(worker: CameraWorker | None) -> None:
        if worker:
            worker.stop()
            worker.join(timeout=3)

    # ----- queries -----
    def worker(self, camera_id: int) -> CameraWorker | None:
        return self._workers.get(camera_id)

    def states(self) -> list[CameraState]:
        with self._lock:
            out = []
            for cid, enabled in sorted(self._enabled.items()):
                w = self._workers.get(cid)
                if w:
                    out.append(w.state())
                elif not enabled:
                    out.append(CameraState(id=cid, status="disabled"))
                else:
                    out.append(CameraState(id=cid, status="offline", error="Model not loaded"))
            return out

    def counts(self) -> tuple[int, int]:
        states = self.states()
        return len(states), sum(s.status in ONLINE for s in states)

    # ----- event feed -----
    @property
    def seq(self) -> int:
        return self._seq

    def events_after(self, seq: int) -> list[dict]:
        return [e for e in list(self._events) if e["seq"] > seq]

    def _on_incident(self, cfg: CameraConfig, frame: np.ndarray, dets: list[Detection]) -> None:
        inc = log_incident(frame, dets, "camera", camera_id=cfg.id, camera_name=cfg.name)
        if not inc:
            return
        with self._lock:
            self._seq += 1
            self._events.append(
                {
                    "seq": self._seq,
                    "type": "incident",
                    "incident": {
                        "id": inc.id,
                        "label": inc.label,
                        "confidence": inc.confidence,
                        "camera_id": cfg.id,
                        "camera_name": cfg.name,
                        "created_at": inc.created_at.isoformat() + "Z",
                    },
                }
            )
        log.warning("INCIDENT %s on %s (%.0f%%)", inc.label.upper(), cfg.name, inc.confidence * 100)

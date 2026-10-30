"""YOLO inference wrapper. Ultralytics is imported lazily so the API (and tests) start without it."""

import logging
import threading
import time
from pathlib import Path
from typing import Protocol

import numpy as np

from ..schemas.detection import Detection

log = logging.getLogger("smokeshield.detector")


class DetectorLike(Protocol):
    loaded: bool
    classes: list[str]
    device: str

    def predict(self, frame: np.ndarray, conf: float) -> list[Detection]: ...


def _normalise_label(name: str) -> str | None:
    n = name.lower()
    if "fire" in n or "flame" in n:
        return "fire"
    if "smoke" in n:
        return "smoke"
    return None


class YoloDetector:
    def __init__(self, weights: Path, image_size: int = 640, device: str = "") -> None:
        self.weights = weights
        self.image_size = image_size
        self.device = device or "auto"
        self.loaded = False
        self.classes: list[str] = []
        self._model = None
        # One model is shared by every camera worker and API request; Ultralytics models are not thread-safe.
        self._lock = threading.Lock()

    def load(self) -> None:
        if not self.weights.exists():
            log.warning("Model weights not found at %s - detection disabled", self.weights)
            return
        from ultralytics import YOLO  # heavy import, keep lazy

        self._model = YOLO(str(self.weights))
        self.classes = list(self._model.names.values())
        self.loaded = True
        self.predict(np.zeros((self.image_size, self.image_size, 3), np.uint8), 0.5)  # warm-up
        log.info("Loaded %s (classes: %s)", self.weights.name, self.classes)

    def predict(self, frame: np.ndarray, conf: float) -> list[Detection]:
        if not self._model:
            raise RuntimeError("Model not loaded")
        h, w = frame.shape[:2]
        kwargs = {"conf": conf, "imgsz": self.image_size, "verbose": False}
        if self.device != "auto":
            kwargs["device"] = self.device
        with self._lock:
            result = self._model.predict(frame, **kwargs)[0]
        out: list[Detection] = []
        for box in result.boxes:
            label = _normalise_label(self._model.names[int(box.cls)])
            if label is None:
                continue
            x1, y1, x2, y2 = box.xyxy[0].tolist()
            out.append(
                Detection(
                    label=label,  # type: ignore[arg-type]
                    confidence=round(float(box.conf), 4),
                    box=(max(0.0, x1 / w), max(0.0, y1 / h), min(1.0, x2 / w), min(1.0, y2 / h)),
                )
            )
        return out


def timed_predict(detector: DetectorLike, frame: np.ndarray, conf: float) -> tuple[list[Detection], float]:
    t0 = time.perf_counter()
    dets = detector.predict(frame, conf)
    return dets, round((time.perf_counter() - t0) * 1000, 1)

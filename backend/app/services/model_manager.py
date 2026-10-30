"""The live model, behind a stable handle.

Camera workers, the browser stream and the REST routes all hold a reference to ONE ModelManager and call
`predict()` on it. Swapping the model replaces what it delegates to, so a new version goes live in place
without restarting workers or dropping any camera. A prediction already running on the old model simply
finishes on it.
"""

import logging
import statistics
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from ..config import settings
from ..schemas.detection import Detection
from .detector import DetectorLike, YoloDetector, normalise_label

log = logging.getLogger("smokeshield.models")

Loader = Callable[[Path], DetectorLike]


class ModelError(Exception):
    """A weights file that cannot be used; the message is safe to show to the user."""


@dataclass(frozen=True)
class ProbeResult:
    classes: list[str]
    params: int | None
    latency_ms: float


def default_loader(path: Path) -> DetectorLike:
    det = YoloDetector(path, settings.image_size, settings.device)
    try:
        det.load()
    except Exception as exc:  # noqa: BLE001 - torch / ultralytics raise many unrelated types
        raise ModelError(f"Could not load these weights as a YOLO model ({type(exc).__name__}: {exc})") from exc
    if not det.loaded:
        raise ModelError("The weights file is missing or empty")
    return det


class ModelManager:
    """Implements DetectorLike by delegating to whichever model is currently active."""

    def __init__(self, loader: Loader = default_loader) -> None:
        self.loader = loader
        self._current: DetectorLike | None = None
        self.version_id: int | None = None
        self.name: str | None = None
        self.swap_lock = threading.RLock()  # serialises activations / rollbacks (re-entrant: rollback calls activate)

    # ----- DetectorLike -----
    @property
    def loaded(self) -> bool:
        cur = self._current
        return cur is not None and cur.loaded

    @property
    def classes(self) -> list[str]:
        cur = self._current
        return cur.classes if cur else []

    @property
    def device(self) -> str:
        cur = self._current
        return cur.device if cur else "auto"

    def predict(self, frame: np.ndarray, conf: float) -> list[Detection]:
        cur = self._current  # one atomic read: the whole call runs on a single model
        if cur is None or not cur.loaded:
            raise RuntimeError("Model not loaded")
        return cur.predict(frame, conf)

    # ----- swapping -----
    def set_current(self, detector: DetectorLike | None, version_id: int | None = None, name: str | None = None) -> None:
        self._current = detector
        self.version_id = version_id
        self.name = name

    # ----- inspection -----
    def probe(self, path: Path) -> tuple[DetectorLike, ProbeResult]:
        """Load weights, check they can detect fire or smoke, and time them on this machine."""
        if not path.is_file():
            raise ModelError("Weights file not found on disk")
        det = self.loader(path)
        require_hazard_classes(det.classes)
        return det, ProbeResult(list(det.classes), getattr(det, "params", None), measure_latency(det))


def require_hazard_classes(classes: list[str]) -> None:
    if not any(normalise_label(c) for c in classes):
        shown = ", ".join(classes[:6]) + (f" and {len(classes) - 6} more" if len(classes) > 6 else "")
        raise ModelError(f"This model has no 'fire' or 'smoke' class (it detects: {shown or 'nothing'})")


def measure_latency(det: DetectorLike, runs: int = 5) -> float:
    """Median inference time on a noise frame, after a warm-up call. Approximate, but comparable across models."""
    frame = np.random.default_rng(0).integers(0, 255, (480, 640, 3), dtype=np.uint8)
    det.predict(frame, 0.25)
    times = []
    for _ in range(runs):
        t0 = time.perf_counter()
        det.predict(frame, 0.25)
        times.append((time.perf_counter() - t0) * 1000)
    return round(statistics.median(times), 1)

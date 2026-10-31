"""Incident episodes: one incident per continuous (or nearly continuous) hazard, never silently dropped.

The old design logged an incident and then discarded every re-trigger for a cooldown period. A flickering flame
that re-confirmed 20 seconds later simply vanished from the incident list. Now:

* a hazard that stays in alarm is ONE incident whose end time keeps moving forward;
* a hazard that returns within the merge window extends the SAME incident instead of being dropped;
* a better (more confident) frame replaces the incident's snapshot while the episode lasts;
* a failed database write is retried on the next frame, because nothing consumes a timer before it succeeds.
"""

import logging
import time
from collections.abc import Callable
from dataclasses import dataclass

import numpy as np

from ..db.session import utcnow
from ..schemas.detection import Detection
from .confirmation import TrackResult
from .incidents import improve_incident, log_incident, touch_incident

log = logging.getLogger("smokeshield.episodes")

Publish = Callable[[str, dict], None]


@dataclass
class _Episode:
    incident_id: int
    peak: float
    last_seen: float  # monotonic
    last_write: float
    last_snapshot: float
    open: bool = True


class EpisodeRecorder:
    TOUCH_EVERY = 5.0  # seconds between "still going" database writes
    SNAPSHOT_EVERY = 2.0  # at most one snapshot rewrite this often
    PEAK_MARGIN = 0.03  # a frame must beat the saved peak by this much to replace it

    def __init__(
        self,
        source: str,
        camera_id: int | None,
        camera_name: str | None,
        merge_window: float,
        publish: Publish | None = None,
    ) -> None:
        self.source, self.camera_id, self.camera_name = source, camera_id, camera_name
        self.merge_window = merge_window
        self._publish = publish
        self._episodes: dict[str, _Episode] = {}

    # ------------------------------------------------------------------ public
    def process(self, frame: np.ndarray, result: TrackResult, now: float | None = None) -> None:
        now = time.monotonic() if now is None else now
        for label in result.active:
            seen = [d for d in result.current if d.label == label]
            ep = self._episodes.get(label)
            if ep is not None and ep.open:
                if seen:
                    self._update(label, ep, frame, seen, now)
            elif seen:  # in alarm with no open episode: resume a recent one, or start a new one (also the retry path)
                if ep is not None and now - ep.last_seen <= self.merge_window:
                    self._resume(label, ep, frame, seen, now)
                else:
                    self._start(label, frame, seen, now)
        for label in result.ended:
            self._close(label)

    def close_all(self) -> None:
        for label in list(self._episodes):
            self._close(label)

    # ------------------------------------------------------------------ steps
    def _start(self, label: str, frame: np.ndarray, seen: list[Detection], now: float) -> None:
        try:
            inc = log_incident(frame, seen, self.source, self.camera_id, self.camera_name)
        except Exception:  # noqa: BLE001 - never take the camera down; the next frame retries
            log.exception("could not record %s incident, will retry", label)
            return
        if inc is None:
            return
        peak = max(d.confidence for d in seen)
        self._episodes[label] = _Episode(inc.id, peak, now, now, now)
        log.warning("INCIDENT #%s %s on %s (%.0f%%)", inc.id, label.upper(), self.camera_name or self.source, peak * 100)
        self._emit("incident", inc.id, label, peak, created_at=inc.created_at.isoformat() + "Z")

    def _resume(self, label: str, ep: _Episode, frame: np.ndarray, seen: list[Detection], now: float) -> None:
        ep.open = True
        log.info("incident #%s resumed (%s came back within the merge window)", ep.incident_id, label)
        self._update(label, ep, frame, seen, now, force=True)

    def _update(self, label: str, ep: _Episode, frame: np.ndarray, seen: list[Detection], now: float, force: bool = False) -> None:
        ep.last_seen = now
        best = max(d.confidence for d in seen)
        try:
            if best > ep.peak + self.PEAK_MARGIN and now - ep.last_snapshot >= self.SNAPSHOT_EVERY:
                if not improve_incident(ep.incident_id, frame, seen, utcnow()):
                    return self._forget(label, ep)
                ep.peak, ep.last_snapshot, ep.last_write = best, now, now
                self._emit("incident_update", ep.incident_id, label, ep.peak)
            elif force or now - ep.last_write >= self.TOUCH_EVERY:
                if not touch_incident(ep.incident_id, utcnow()):
                    return self._forget(label, ep)
                ep.last_write = now
                self._emit("incident_update", ep.incident_id, label, ep.peak)
        except Exception:  # noqa: BLE001
            log.exception("could not update incident #%s", ep.incident_id)

    def _close(self, label: str) -> None:
        ep = self._episodes.get(label)
        if ep is None or not ep.open:
            return
        ep.open = False  # kept in memory so a quick return merges into this incident
        try:
            if not touch_incident(ep.incident_id, utcnow()):
                return self._forget(label, ep)
            self._emit("incident_update", ep.incident_id, label, ep.peak)
        except Exception:  # noqa: BLE001
            log.exception("could not close incident #%s", ep.incident_id)

    def _forget(self, label: str, ep: _Episode) -> None:
        """The incident was deleted while the hazard was still on screen: drop it so the next sighting is recorded afresh."""
        log.info("incident #%s was deleted; a continuing %s will be recorded as a new incident", ep.incident_id, label)
        self._episodes.pop(label, None)

    def _emit(self, kind: str, incident_id: int, label: str, confidence: float, **extra) -> None:
        if self._publish:
            self._publish(kind, {
                "id": incident_id, "label": label, "confidence": confidence,
                "camera_id": self.camera_id, "camera_name": self.camera_name or "Browser Cam", **extra,
            })

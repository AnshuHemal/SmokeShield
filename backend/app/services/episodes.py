"""Incident episodes: ONE incident per continuous (or nearly continuous) hazard event, never silently dropped.

What counts as one event:

* a flame and the smoke around it are the same event, not two: fire and smoke share a single incident, filed as fire
  as soon as any fire is seen (a lighter usually shows smoke first, then flame - still one incident);
* a hazard that stays in alarm is ONE incident whose end time keeps moving forward;
* a hazard that returns within the merge window extends the SAME incident instead of starting another;
* a better frame (a clearer or more confident picture, or the first one showing fire) replaces the incident's
  snapshot in place, so the list shows one picture per event - the best one;
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
from .incidents import headline, improve_incident, log_incident, touch_incident

log = logging.getLogger("smokeshield.episodes")

Publish = Callable[[str, dict], None]


@dataclass
class _Episode:
    incident_id: int
    label: str  # what the incident is filed as right now: "fire" once any fire was seen, else "smoke"
    peak: float  # best confidence of that label so far
    last_seen: float  # monotonic
    last_write: float
    last_snapshot: float
    open: bool = True


class EpisodeRecorder:
    TOUCH_EVERY = 5.0  # seconds between "still going" database writes
    SNAPSHOT_EVERY = 2.0  # at most one snapshot rewrite this often (the first sighting of fire is exempt)
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
        self._ep: _Episode | None = None  # one source = one hazard event at a time, whatever the labels

    # ------------------------------------------------------------------ public
    def process(self, frame: np.ndarray, result: TrackResult, now: float | None = None) -> None:
        now = time.monotonic() if now is None else now
        ep = self._ep
        if result.active:
            seen = result.current
            if ep is not None and ep.open:
                if seen:
                    self._update(ep, frame, seen, now)
            elif seen:  # in alarm with no open episode: resume a recent one, or start a new one (also the retry path)
                if ep is not None and now - ep.last_seen <= self.merge_window:
                    self._resume(ep, frame, seen, now)
                else:
                    self._start(frame, seen, now)
        elif ep is not None and ep.open:
            self._close(ep)

    def close_all(self) -> None:
        if self._ep is not None:
            self._close(self._ep)

    # ------------------------------------------------------------------ steps
    def _start(self, frame: np.ndarray, seen: list[Detection], now: float) -> None:
        try:
            inc = log_incident(frame, seen, self.source, self.camera_id, self.camera_name)
        except Exception:  # noqa: BLE001 - never take the camera down; the next frame retries
            log.exception("could not record incident, will retry")
            return
        if inc is None:
            return
        self._ep = _Episode(inc.id, inc.label, inc.confidence, now, now, now)
        log.warning("INCIDENT #%s %s on %s (%.0f%%)", inc.id, inc.label.upper(), self.camera_name or self.source, inc.confidence * 100)
        self._emit("incident", self._ep, created_at=inc.created_at.isoformat() + "Z")

    def _resume(self, ep: _Episode, frame: np.ndarray, seen: list[Detection], now: float) -> None:
        ep.open = True
        log.info("incident #%s resumed (the hazard came back within the merge window)", ep.incident_id)
        self._update(ep, frame, seen, now, force=True)

    def _update(self, ep: _Episode, frame: np.ndarray, seen: list[Detection], now: float, force: bool = False) -> None:
        ep.last_seen = now
        label, best = headline(seen)
        first_fire = label == "fire" and ep.label != "fire"  # smoke first, flame next: the same incident, now filed as fire
        clearer = label == ep.label and best > ep.peak + self.PEAK_MARGIN and now - ep.last_snapshot >= self.SNAPSHOT_EVERY
        try:
            if first_fire or clearer:
                if not improve_incident(ep.incident_id, frame, seen, utcnow()):
                    return self._forget(ep)
                ep.label, ep.peak, ep.last_snapshot, ep.last_write = label, best, now, now
                self._emit("incident_update", ep)
            elif force or now - ep.last_write >= self.TOUCH_EVERY:
                if not touch_incident(ep.incident_id, utcnow()):
                    return self._forget(ep)
                ep.last_write = now
                self._emit("incident_update", ep)
        except Exception:  # noqa: BLE001
            log.exception("could not update incident #%s", ep.incident_id)

    def _close(self, ep: _Episode) -> None:
        if not ep.open:
            return
        ep.open = False  # kept in memory so a quick return merges into this incident
        try:
            if not touch_incident(ep.incident_id, utcnow()):
                return self._forget(ep)
            self._emit("incident_update", ep)
        except Exception:  # noqa: BLE001
            log.exception("could not close incident #%s", ep.incident_id)

    def _forget(self, ep: _Episode) -> None:
        """The incident was deleted while the hazard was still on screen: drop it so the next sighting is recorded afresh."""
        log.info("incident #%s was deleted; a continuing hazard will be recorded as a new incident", ep.incident_id)
        if self._ep is ep:
            self._ep = None

    def _emit(self, kind: str, ep: _Episode, **extra) -> None:
        if self._publish:
            self._publish(kind, {
                "id": ep.incident_id, "label": ep.label, "confidence": ep.peak,
                "camera_id": self.camera_id, "camera_name": self.camera_name or "Browser Cam", **extra,
            })

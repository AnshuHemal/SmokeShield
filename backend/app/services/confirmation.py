"""Turns a noisy stream of per-frame detections into a stable alarm.

Per-frame YOLO output flickers: a small or flickering flame is found in some frames and missed in others, and its
confidence hovers around the threshold. Using it raw gives a slow, blinking alarm. The tracker adds three things:

* confirmation   - a hazard must be seen in N of the last M frames before it counts, so one-frame glitches never alarm
* instant path   - a single very confident detection confirms at once, so obvious fire does not wait for N frames
* hysteresis     - once confirmed, the alarm stays on (and the last box stays visible) for `hold_s` seconds after the
                   last sighting, so one or two missed frames cannot make it blink off and back on
"""

import time
from collections import deque
from dataclasses import dataclass, field

from ..config import settings
from ..schemas.detection import Detection

LABELS = ("fire", "smoke")


@dataclass
class TrackResult:
    active: set[str] = field(default_factory=set)  # labels in alarm right now (including during hold-over)
    shown: list[Detection] = field(default_factory=list)  # boxes to draw: current ones, plus the last known one while held
    current: list[Detection] = field(default_factory=list)  # confirmed detections seen in THIS frame (never held copies)
    pending: list[Detection] = field(default_factory=list)  # seen this frame but not confirmed yet ("verifying")
    ended: set[str] = field(default_factory=set)  # labels whose alarm just ended this frame


class AlarmTracker:
    def __init__(
        self,
        required: int,
        window: int,
        hold_s: float | None = None,
        instant_conf: float | None = None,
    ) -> None:
        self.window = max(1, window)
        self.required = max(1, min(required, self.window))
        self.hold_s = settings.alarm_hold_seconds if hold_s is None else hold_s
        self.instant_conf = settings.instant_confidence if instant_conf is None else instant_conf
        self._history: dict[str, deque[bool]] = {l: deque(maxlen=self.window) for l in LABELS}
        self._last_seen: dict[str, float] = {}  # label -> time of last sighting, present only while in alarm
        self._held: dict[str, Detection] = {}  # label -> strongest recent detection, drawn while held
        self._last_update: float | None = None
        self._frame_gap = 0.0  # smoothed seconds between frames

    def update(self, detections: list[Detection], now: float | None = None) -> TrackResult:
        now = time.monotonic() if now is None else now
        if self._last_update is not None:
            gap = max(0.0, now - self._last_update)
            # one stall (a frozen camera, a paused laptop) must not stretch the hold indefinitely
            gap = min(gap, max(2 * self._frame_gap if self._frame_gap else 5.0, 1.0))
            self._frame_gap = gap if self._frame_gap == 0 else self._frame_gap * 0.8 + gap * 0.2
        self._last_update = now
        # A slow camera (large inference size, busy server) sees few frames per second: never hold for less than
        # three frame intervals, or a single slow gap would end the alarm.
        hold = max(self.hold_s, 3 * self._frame_gap)
        out = TrackResult()
        for label in LABELS:
            seen = [d for d in detections if d.label == label]
            present = bool(seen)
            history = self._history[label]
            history.append(present)

            if label in self._last_seen:
                if present:
                    self._last_seen[label] = now
                    self._held[label] = max(seen, key=lambda d: d.confidence)
                elif now - self._last_seen[label] > hold:
                    # nothing seen for the whole hold period: the alarm is over; demand fresh evidence next time
                    del self._last_seen[label]
                    self._held.pop(label, None)
                    history.clear()
                    out.ended.add(label)
            elif present and (sum(history) >= self.required or any(d.confidence >= self.instant_conf for d in seen)):
                self._last_seen[label] = now
                self._held[label] = max(seen, key=lambda d: d.confidence)

            if label in self._last_seen:
                out.active.add(label)
                if present:
                    out.current.extend(seen)
                    out.shown.extend(seen)
                else:
                    out.shown.append(self._held[label].model_copy(update={"held": True}))
            elif present:
                out.pending.extend(seen)
        return out

    def reset(self) -> set[str]:
        """Forget everything (camera went offline). Returns the labels that were in alarm, so callers can close them."""
        was_active = set(self._last_seen)
        self._last_seen.clear()
        self._held.clear()
        self._last_update, self._frame_gap = None, 0.0
        for h in self._history.values():
            h.clear()
        return was_active

from collections import deque

from ..schemas.detection import Detection

LABELS = ("fire", "smoke")


class TemporalConfirmer:
    """Raise a hazard only when it appears in at least `required` of the last `window` frames.

    A single-frame glitch (reflection, flash, compression artefact) never reaches the threshold,
    while a real fire is seen in consecutive frames and confirms within a fraction of a second.
    """

    def __init__(self, required: int, window: int) -> None:
        self.required = max(1, min(required, window))
        self.window = max(1, window)
        self._history: dict[str, deque[bool]] = {l: deque(maxlen=self.window) for l in LABELS}

    def update(self, detections: list[Detection]) -> set[str]:
        """Record one frame and return the labels that are currently confirmed."""
        seen = {d.label for d in detections}
        confirmed: set[str] = set()
        for label, history in self._history.items():
            history.append(label in seen)
            if sum(history) >= self.required:
                confirmed.add(label)
        return confirmed

    def reset(self) -> None:
        for h in self._history.values():
            h.clear()

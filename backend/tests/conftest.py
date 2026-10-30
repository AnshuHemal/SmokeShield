import os
import tempfile
from pathlib import Path

# Must happen before the app is imported: tests use a throw-away database, snapshot folder and models folder.
_TMP = Path(tempfile.mkdtemp(prefix="smokeshield-test-"))
os.environ["SMOKESHIELD_DATA_DIR"] = str(_TMP / "data")
os.environ["SMOKESHIELD_MODEL_PATH"] = str(_TMP / "bundled" / "best.pt")  # does not exist: nothing is auto-registered

import cv2  # noqa: E402
import numpy as np  # noqa: E402
import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402
from app.schemas.detection import Detection  # noqa: E402
from app.services.model_manager import ModelError  # noqa: E402


class FakeDetector:
    """Reports one detection of `label` in every frame."""

    loaded = True
    device = "cpu"
    params = 1_000_000

    def __init__(self, label: str = "fire", classes: list[str] | None = None) -> None:
        self.label = label
        self.classes = classes if classes is not None else ["smoke", "fire"]

    def predict(self, frame, conf):
        return [Detection(label=self.label, confidence=0.9, box=(0.1, 0.1, 0.6, 0.6))]  # type: ignore[arg-type]


class MissingModel(FakeDetector):
    loaded = False

    def __init__(self) -> None:
        super().__init__()
        self.classes = []

    def predict(self, frame, conf):  # pragma: no cover
        raise AssertionError("should not be called")


def fake_loader(path: Path):
    """The file's content decides what 'loading' does, so tests control it by writing different bytes."""
    data = path.read_bytes()
    if data.startswith(b"BAD"):
        raise ModelError("Could not load these weights as a YOLO model (test)")
    if data.startswith(b"NOCLASS"):
        return FakeDetector(classes=["cat", "dog"])
    if data.startswith(b"HYDRANT"):  # COCO-style: "fire hydrant" must NOT count as fire
        return FakeDetector(classes=["person", "fire hydrant"])
    return FakeDetector(label="smoke" if data.startswith(b"SMOKE") else "fire")


def make_jpeg(w=64, h=48) -> bytes:
    ok, buf = cv2.imencode(".jpg", np.full((h, w, 3), 127, np.uint8))
    assert ok
    return buf.tobytes()


def make_video(path, frames=40, fps=10, w=96, h=72) -> None:
    writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"MJPG"), fps, (w, h))
    rng = np.random.default_rng(0)
    for _ in range(frames):
        writer.write(rng.integers(0, 255, (h, w, 3), dtype=np.uint8))
    writer.release()


@pytest.fixture()
def client():
    app.state.detector = FakeDetector()
    app.state.model_loader = fake_loader
    with TestClient(app) as c:
        yield c


@pytest.fixture()
def jpeg() -> bytes:
    return make_jpeg()

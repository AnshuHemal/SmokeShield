import os
import tempfile

# Must happen before the app is imported: tests use a throw-away database and snapshot folder.
os.environ["SMOKESHIELD_DATA_DIR"] = tempfile.mkdtemp(prefix="smokeshield-test-")

import cv2  # noqa: E402
import numpy as np  # noqa: E402
import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402
from app.schemas.detection import Detection  # noqa: E402


class FakeDetector:
    """Reports a fire in every frame."""

    loaded = True
    classes = ["smoke", "fire"]
    device = "cpu"

    def predict(self, frame, conf):
        return [Detection(label="fire", confidence=0.9, box=(0.1, 0.1, 0.6, 0.6))]


class MissingModel(FakeDetector):
    loaded = False
    classes: list[str] = []

    def predict(self, frame, conf):  # pragma: no cover
        raise AssertionError("should not be called")


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
    with TestClient(app) as c:
        yield c


@pytest.fixture()
def jpeg() -> bytes:
    return make_jpeg()

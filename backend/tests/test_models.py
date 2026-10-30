import pytest

from app.config import settings
from app.services.detector import normalise_label
from app.db.models import ModelVersion
from app.db.session import SessionLocal, init_db
from app.services import model_registry


@pytest.fixture(autouse=True)
def clean_registry():
    """The database is shared by the whole session; start every test with an empty registry."""
    init_db()  # works even when this file runs alone, before any app has started

    def wipe():
        with SessionLocal() as db:
            db.query(ModelVersion).delete()
            db.commit()
        for f in settings.uploaded_models_dir.glob("*.pt"):
            f.unlink()
    wipe()
    yield
    wipe()


def upload(client, name="Model", content=b"FIRE-weights", filename="best.pt", **fields):
    return client.post(
        "/api/models",
        data={"name": name, **{k: str(v) for k, v in fields.items()}},
        files={"file": (filename, content, "application/octet-stream")},
    )


def detect_label(client, jpeg) -> str:
    r = client.post("/api/detect/image", files={"file": ("a.jpg", jpeg, "image/jpeg")})
    incident = r.json()["incident_id"]
    label = r.json()["detections"][0]["label"]
    client.delete(f"/api/incidents/{incident}")
    return label


def active(client):
    return [m for m in client.get("/api/models").json() if m["is_active"]]


def test_upload_registers_an_inactive_version_with_facts_from_the_weights(client):
    r = upload(client, "First", b"FIRE-aaa", map50=0.77, recall=0.69, notes="Colab run")
    assert r.status_code == 201
    m = r.json()
    assert m["is_active"] is False and m["location"] == "uploaded"
    assert m["classes"] == ["smoke", "fire"] and m["latency_ms"] is not None and m["params_m"] == 1.0
    assert m["map50"] == 0.77 and m["recall"] == 0.69 and m["precision"] is None and m["notes"] == "Colab run"
    assert m["file_exists"] is True and m["size_mb"] >= 0
    assert active(client) == []  # uploading never changes the live model


def test_activate_hot_swaps_the_live_model(client, jpeg):
    assert detect_label(client, jpeg) == "fire"  # the injected starting model
    smoke = upload(client, "Smoke model", b"SMOKE-bbb").json()

    r = client.post(f"/api/models/{smoke['id']}/activate")
    assert r.status_code == 200 and r.json()["is_active"] is True and r.json()["activated_at"].endswith("Z")

    health = client.get("/api/health").json()
    assert health["model_name"] == "Smoke model" and health["model_version_id"] == smoke["id"]
    assert detect_label(client, jpeg) == "smoke"  # same endpoint, new model, no restart


def test_only_one_version_is_active_and_rollback_returns_to_the_previous(client, jpeg):
    a = upload(client, "A", b"FIRE-a").json()
    b = upload(client, "B", b"SMOKE-b").json()
    client.post(f"/api/models/{a['id']}/activate")
    client.post(f"/api/models/{b['id']}/activate")
    assert [m["name"] for m in active(client)] == ["B"]
    assert detect_label(client, jpeg) == "smoke"

    r = client.post("/api/models/rollback")
    assert r.status_code == 200 and r.json()["name"] == "A"
    assert [m["name"] for m in active(client)] == ["A"]
    assert detect_label(client, jpeg) == "fire"

    # rolling back again goes back to B (the one that was live just before A)
    assert client.post("/api/models/rollback").json()["name"] == "B"


def test_rollback_without_history_is_a_conflict(client):
    only = upload(client, "Only", b"FIRE-only").json()
    client.post(f"/api/models/{only['id']}/activate")
    assert client.post("/api/models/rollback").status_code == 409


def test_failed_activation_keeps_the_current_model(client, jpeg):
    good = upload(client, "Good", b"SMOKE-good").json()
    broken = upload(client, "Broken", b"FIRE-will-break").json()
    client.post(f"/api/models/{good['id']}/activate")

    (settings.uploaded_models_dir / broken["filename"]).write_bytes(b"BAD-corrupted")  # damaged after upload
    r = client.post(f"/api/models/{broken['id']}/activate")
    assert r.status_code == 422 and "Could not load" in r.json()["detail"]
    assert [m["name"] for m in active(client)] == ["Good"]
    assert detect_label(client, jpeg) == "smoke"  # still serving on the old model


def test_active_model_cannot_be_deleted_but_others_can(client):
    a = upload(client, "A", b"FIRE-a").json()
    b = upload(client, "B", b"FIRE-b").json()
    client.post(f"/api/models/{a['id']}/activate")

    assert client.delete(f"/api/models/{a['id']}").status_code == 409
    path = settings.uploaded_models_dir / b["filename"]
    assert path.exists()
    assert client.delete(f"/api/models/{b['id']}").status_code == 204
    assert not path.exists()  # the file goes with the record
    assert client.delete(f"/api/models/{b['id']}").status_code == 404


@pytest.mark.parametrize(
    "kwargs, status",
    [
        (dict(filename="weights.onnx"), 400),  # wrong type
        (dict(content=b""), 400),  # empty file
        (dict(content=b"BAD-not-a-model"), 422),  # cannot be loaded
        (dict(content=b"NOCLASS-cats"), 422),  # loads, but cannot detect fire or smoke
        (dict(content=b"HYDRANT-coco"), 422),  # "fire hydrant" is not fire
        (dict(name="   "), 422),  # blank name
        (dict(map50=1.5), 422),  # metric out of range
    ],
)
def test_rejected_uploads_leave_nothing_behind(client, kwargs, status):
    r = upload(client, **kwargs)
    assert r.status_code == status, r.text
    assert client.get("/api/models").json() == []
    assert list(settings.uploaded_models_dir.glob("*.pt")) == []


def test_duplicate_file_is_rejected(client):
    assert upload(client, "One", b"FIRE-same").status_code == 201
    r = upload(client, "Two", b"FIRE-same")
    assert r.status_code == 409 and "One" in r.json()["detail"]
    assert len(list(settings.uploaded_models_dir.glob("*.pt"))) == 1


def test_oversize_upload_is_rejected(client, monkeypatch):
    monkeypatch.setattr(settings, "max_model_mb", 0)
    assert upload(client, content=b"FIRE-" + b"x" * 10).status_code == 413
    assert list(settings.uploaded_models_dir.glob("*.pt")) == []


def test_uploads_can_be_disabled(client, monkeypatch):
    monkeypatch.setattr(settings, "model_upload_enabled", False)
    assert upload(client).status_code == 403


def test_edit_metadata_and_clear_a_metric(client):
    m = upload(client, "Draft", b"FIRE-edit", map50=0.5).json()
    r = client.patch(f"/api/models/{m['id']}", json={"name": "Final", "precision": 0.8, "map50": None, "notes": "ok"})
    assert r.status_code == 200
    body = r.json()
    assert body["name"] == "Final" and body["precision"] == 0.8 and body["map50"] is None and body["notes"] == "ok"
    assert client.patch(f"/api/models/{m['id']}", json={"recall": 3}).status_code == 422
    assert client.patch(f"/api/models/{m['id']}", json={"filename": "x"}).status_code == 422  # not editable


def test_benchmark_refreshes_speed_and_classes(client):
    m = upload(client, "Bench", b"FIRE-bench").json()
    with SessionLocal() as db:  # simulate a version registered before facts were known
        row = db.get(ModelVersion, m["id"])
        row.classes = row.latency_ms = row.params = None
        db.commit()
    r = client.post(f"/api/models/{m['id']}/benchmark")
    assert r.status_code == 200 and r.json()["classes"] == ["smoke", "fire"] and r.json()["latency_ms"] is not None


def test_seeding_registers_existing_files_once_and_marks_one_active(tmp_path):
    (tmp_path / "best.pt").write_bytes(b"FIRE-current")
    (tmp_path / "best_v1.pt").write_bytes(b"FIRE-old")
    (tmp_path / "notes.txt").write_text("ignored")

    model_registry.seed_from_disk(tmp_path, "best.pt")
    model_registry.seed_from_disk(tmp_path, "best.pt")  # idempotent

    with SessionLocal() as db:
        rows = {v.filename: v for v in db.query(ModelVersion).all()}
    assert set(rows) == {"best.pt", "best_v1.pt"}
    assert rows["best.pt"].is_active and not rows["best_v1.pt"].is_active
    assert rows["best.pt"].name == "Best" and len(rows["best.pt"].sha256) == 64 and rows["best_v1.pt"].location == "bundled"


@pytest.mark.parametrize(
    "name, expected",
    [
        ("fire", "fire"), ("Fire", "fire"), ("FLAME", "fire"), ("flames", "fire"), ("wild-fire", None), ("wildfire", "fire"),
        ("smoke", "smoke"), (" Smoke ", "smoke"),
        ("fire hydrant", None), ("fire_truck", None), ("campfire", None), ("smoker", None), ("person", None),
    ],
)
def test_class_names_are_matched_exactly(name, expected):
    assert normalise_label(name) == expected

import io
import zipfile


def make_incident(client, jpeg) -> int:
    r = client.post("/api/detect/image", files={"file": ("a.jpg", jpeg, "image/jpeg")})
    return r.json()["incident_id"]


def test_review_workflow_and_stats(client, jpeg):
    a, b = make_incident(client, jpeg), make_incident(client, jpeg)
    assert client.patch(f"/api/incidents/{a}/review", json={"status": "real"}).json()["status"] == "real"
    reviewed = client.patch(f"/api/incidents/{b}/review", json={"status": "false_alarm"}).json()
    assert reviewed["reviewed_at"].endswith("Z")

    stats = client.get("/api/stats").json()
    assert stats["real"] >= 1 and stats["false_alarms"] >= 1
    assert 0 < stats["false_alarm_rate"] < 1

    only_false = client.get("/api/incidents?status=false_alarm").json()
    assert b in [i["id"] for i in only_false] and a not in [i["id"] for i in only_false]

    # undo goes back to "new" and clears the review time
    undone = client.patch(f"/api/incidents/{b}/review", json={"status": "new"}).json()
    assert undone["status"] == "new" and undone["reviewed_at"] is None
    client.delete(f"/api/incidents/{a}"), client.delete(f"/api/incidents/{b}")


def test_invalid_review_status_rejected(client, jpeg):
    i = make_incident(client, jpeg)
    assert client.patch(f"/api/incidents/{i}/review", json={"status": "maybe"}).status_code == 422
    client.delete(f"/api/incidents/{i}")


def test_training_export_contains_labels_and_negatives(client, jpeg):
    real, fake = make_incident(client, jpeg), make_incident(client, jpeg)
    client.patch(f"/api/incidents/{real}/review", json={"status": "real"})
    client.patch(f"/api/incidents/{fake}/review", json={"status": "false_alarm"})

    r = client.get("/api/incidents/export/training")
    assert r.status_code == 200 and r.headers["content-type"] == "application/zip"
    z = zipfile.ZipFile(io.BytesIO(r.content))
    names = set(z.namelist())
    assert "data.yaml" in names
    real_label = z.read(f"labels/incident_{real}_real.txt").decode().split()
    assert real_label[0] == "1" and len(real_label) == 5  # class 1 = fire, then cx cy w h
    assert z.read(f"labels/incident_{fake}_false_alarm.txt") == b""  # negative example
    assert f"images/incident_{real}_real.jpg" in names
    client.delete(f"/api/incidents/{real}"), client.delete(f"/api/incidents/{fake}")

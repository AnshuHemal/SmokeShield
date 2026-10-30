from app.main import _dist


def test_deep_links_serve_the_app_but_api_misses_stay_404(client):
    if not _dist.exists():  # frontend not built in this environment
        return
    assert "<div id=\"root\">" in client.get("/monitor").text
    assert "<div id=\"root\">" in client.get("/incidents").text
    assert client.get("/api/nope").status_code == 404
    assert client.get("/assets/missing.js").status_code == 404

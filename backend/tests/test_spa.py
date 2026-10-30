from app.main import _dist


def test_deep_links_serve_the_app_but_api_misses_stay_404(client):
    if not _dist.exists():  # frontend not built in this environment
        return
    assert "<div id=\"root\">" in client.get("/monitor").text
    assert "<div id=\"root\">" in client.get("/incidents").text
    assert client.get("/api/nope").status_code == 404
    assert client.get("/assets/missing.js").status_code == 404


def test_entry_page_is_never_cached_but_fingerprinted_assets_are(client):
    if not _dist.exists():
        return
    # a stale index.html would keep users on the previous build after a deploy
    assert client.get("/").headers["cache-control"] == "no-cache"
    assert client.get("/models").headers["cache-control"] == "no-cache"  # deep link falls back to index.html
    asset = next((_dist / "assets").glob("*.js"))
    assert "immutable" in client.get(f"/assets/{asset.name}").headers["cache-control"]

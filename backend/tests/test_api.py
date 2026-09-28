"""API contract tests — offline, AI disabled (exercises every deterministic fallback)."""
import io


def test_health_and_meta(client):
    assert client.get("/api/health").json()["ok"] is True
    m = client.get("/api/meta").json()
    assert m["product"] == "Albedo-Watch" and len(m["states"]) >= 25 and m["measures"]


def test_pulse_covers_india(client):
    p = client.get("/api/pulse").json()
    assert p["summary"]["cities"] >= 50 and p["summary"]["states"] >= 25
    assert all("naqi" in c and "authority" in c for c in p["cities"])


def test_city_detail_and_unknown_city(client):
    d = client.get("/api/city/delhi").json()
    assert d["series"]["naqi"] and d["authority"]["primary_short"] == "CAQM"
    assert client.get("/api/city/atlantis").status_code == 404


def test_timeline_corridors_wind_fires(client):
    assert len(client.get("/api/timeline").json()["frames"]) == 33
    cors = client.get("/api/corridors").json()["corridors"]
    assert {c["id"] for c in cors} >= {"igp", "ncr"}
    assert client.get("/api/wind").json()["vectors"]
    assert client.get("/api/fires").json()["count"] > 0


def test_attribution_has_fallback_narrative(client):
    a = client.get("/api/attribution/ludhiana").json()
    assert abs(sum(s["share"] for s in a["sources"]) - 1) < 0.02
    assert len(a["paths"]) == 7 and a["narrative"]["headline"]


def test_simulate_validates(client):
    r = client.post("/api/simulate", json={"city": "delhi", "measures": ["cnd_ban"], "compliance": 0.7}).json()
    assert r["pm25_after"] <= r["pm25_before"]
    assert client.post("/api/simulate", json={"city": "delhi", "compliance": 5}).status_code == 422


def test_report_requires_evidence_and_region(client):
    assert client.post("/api/reports", data={"lat": 28.6, "lon": 77.2}).status_code == 422
    assert client.post("/api/reports", data={"lat": 95, "lon": -0.1, "text": "smoke"}).status_code == 422
    bad = client.post("/api/reports", data={"lat": 28.6, "lon": 77.2}, files={"photos": ("x.gif", b"GIF89a", "image/gif")})
    assert bad.status_code == 422


def test_report_roundtrip_and_alert_workflow(client):
    from PIL import Image
    buf = io.BytesIO(); Image.new("RGB", (64, 64), (120, 120, 120)).save(buf, "JPEG")
    r = client.post("/api/reports", data={"lat": 30.35, "lon": 75.2, "text": "ਪਰਾਲੀ ਸਾੜੀ ਜਾ ਰਹੀ ਹੈ", "lang": "pa"},
                    files={"photos": ("p.jpg", buf.getvalue(), "image/jpeg")})
    assert r.status_code == 200, r.text
    rep = r.json()
    assert rep["thumb"].startswith("data:image/jpeg") and rep["jurisdiction"]["state_code"] == "PB"
    assert rep["verification"]["status"] in {"verified", "probable", "unverified", "rejected"}
    assert any(x["id"] == rep["id"] for x in client.get("/api/reports").json()["reports"])

    a = client.post("/api/alerts/draft", json={"kind": "report", "report_id": rep["id"]}).json()
    assert a["status"] == "draft" and a["draft"]["actions"]
    for st in ("approved", "dispatched", "acknowledged", "resolved"):
        a = client.post(f"/api/alerts/{a['id']}/status", json={"status": st}).json()
    assert a["status"] == "resolved" and len(a["timeline"]) == 5
    assert any("simulated" in c for c in a["timeline"][2]["channels"])


def test_city_alert_leads_with_english_then_local_languages(client):
    a = client.post("/api/alerts/draft", json={"kind": "city", "city": "chennai"}).json()
    assert a["languages"][:2] == ["en", "ta"]
    b = client.post("/api/alerts/draft", json={"kind": "city", "city": "saopaulo"}).json()
    assert b["languages"] == ["en", "pt"] and "GRAP" not in b["context"]["response_stage"].get("framework", "")
    c = client.post("/api/alerts/draft", json={"kind": "city", "city": "delhi", "languages": ["pa"]}).json()
    assert c["languages"] == ["pa"]  # an explicit choice is respected


def test_world_coverage_and_index_systems(client):
    p = client.get("/api/pulse").json()
    s = p["summary"]
    assert s["cities"] > 200 and s["countries"] > 80 and s["india_cities"] == 53
    systems = {c["index_system"] for c in p["cities"]}
    assert systems == {"NAQI", "US AQI"}
    london = next(c for c in p["cities"] if c["id"] == "london")
    assert london["index_system"] == "US AQI" and london["country_name"] == "United Kingdom"


def test_place_intel_anywhere(client):
    r = client.get("/api/place", params={"lat": 48.8566, "lon": 2.3522}).json()
    assert r["forecast"]["now"]["system"] == "US AQI" and r["languages"][0] == "en"
    assert "satellite" in r["imagery"] and r["imagery"]["satellite"][0]["url"].startswith("https://wvs.earthdata.nasa.gov")
    assert client.get("/api/place", params={"lat": 123, "lon": 0}).status_code == 422


def test_place_alert_any_location(client):
    a = client.post("/api/alerts/draft", json={"kind": "place", "lat": -23.55, "lon": -46.63, "attach_imagery": False}).json()
    assert a["status"] == "draft" and a["draft"]["actions"] and a["languages"][0] == "en"


def test_fires_modes_and_definition(client):
    agg = client.get("/api/fires").json()
    assert agg["mode"] == "aggregate" and "definition" in agg and agg["bins"]
    det = client.get("/api/fires", params={"bbox": "70,25,80,35"}).json()
    assert det["mode"] == "detections"
    assert client.get("/api/fires", params={"bbox": "bad"}).status_code == 422


def test_overview_is_fast_and_complete(client):
    o = client.get("/api/overview").json()
    assert o["summary"]["cities"] > 200 and o["fires"]["count"] > 0


def test_ask_degrades_gracefully(client):
    r = client.post("/api/ask", json={"question": "दिल्ली की हवा कैसी है?"}).json()
    assert r["answer"]
    assert client.post("/api/ask", json={"question": "x"}).status_code == 422


def test_commons_and_interop(client):
    c = client.get("/api/commons").json()
    assert c["summary"]["nodes"] >= 2 and c["card"]["global_weights"]
    s = client.get("/api/interop/schema").json()
    assert s["title"].startswith("Open Air Event Protocol")
    g = client.get("/api/interop/events.geojson").json()
    assert g["type"] == "FeatureCollection"


def test_security_headers_allow_camera_and_mic(client):
    h = client.get("/api/health").headers
    assert h["x-content-type-options"] == "nosniff"
    assert "microphone=(self)" in h["permissions-policy"] and "camera=(self)" in h["permissions-policy"]


def test_event_feed(client):
    client.get("/api/pulse")
    e = client.get("/api/events").json()["events"]
    assert e and all({"id", "kind", "title", "t"} <= set(x) for x in e)
    assert client.get("/api/events", params={"limit": 500}).status_code == 422

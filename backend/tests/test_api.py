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
    assert client.post("/api/reports", data={"lat": 51.5, "lon": -0.1, "text": "smoke"}).status_code == 422
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


def test_city_alert_uses_state_languages(client):
    a = client.post("/api/alerts/draft", json={"kind": "city", "city": "chennai"}).json()
    assert a["languages"][0] == "ta" and "en" in a["languages"]


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

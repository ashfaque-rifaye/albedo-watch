import asyncio
import math

import numpy as np

from app.engines import attribution, datahub, federated, forecast, response
from app.engines.naqi import category, grap_stage, naqi, sub_index
from app.geo import bearing_deg, haversine_km, wind_uv


# ------------------------------------------------------------------ NAQI
def test_naqi_breakpoints_match_cpcb():
    assert sub_index("pm25", 30) == 50
    assert round(sub_index("pm25", 60)) == 100
    assert round(sub_index("pm25", 90)) == 200
    assert round(sub_index("pm25", 250)) == 400
    assert sub_index("pm10", 100) == 100


def test_naqi_needs_particulates_and_picks_dominant():
    assert naqi({"no2": 100}) == (None, None)
    idx, dom = naqi({"pm25": 95, "pm10": 80, "no2": 20})
    assert dom == "pm25" and 200 < idx <= 300


def test_naqi_caps_at_500_and_handles_bad_input():
    assert naqi({"pm25": 2000})[0] == 500
    assert sub_index("pm25", None) is None and sub_index("pm25", float("nan")) is None and sub_index("pm25", -1) is None


def test_category_and_grap_stages():
    assert category(45)["label"] == "Good"
    assert category(305)["label"] == "Very Poor"
    assert grap_stage(150)["stage"] == 0
    assert grap_stage(250)["stage"] == 1
    assert grap_stage(420)["stage"] == 3
    assert grap_stage(480)["stage"] == 4


# ------------------------------------------------------------------ geo
def test_geo_helpers():
    assert abs(haversine_km(28.61, 77.21, 19.07, 72.88) - 1150) < 20  # Delhi–Mumbai
    assert 180 < bearing_deg(28.61, 77.21, 19.07, 72.88) < 225
    u, v = wind_uv(10, 270)  # wind FROM the west blows east
    assert u > 9.9 and abs(v) < 1e-6


# ------------------------------------------------------------------ trajectories
def test_back_trajectory_goes_upwind():
    field = asyncio.run(datahub.wind_field())  # synthetic: steady NW (310°) wind
    import time
    paths = attribution.trajectories(field, 28.6, 77.2, time.time(), hours=12)
    assert len(paths) == 7
    end = paths[0][-1]
    # air arrived from the north-west, so 12 h earlier it was NW of Delhi
    assert end["lat"] > 28.6 and end["lon"] < 77.2


def test_fire_influence_attributes_upwind_fires():
    import time
    field = asyncio.run(datahub.wind_field())
    paths = attribution.trajectories(field, 28.6, 77.2, time.time(), hours=48)
    upwind = [{"lat": p["lat"], "lon": p["lon"], "frp": 50.0, "t": p["t"]} for p in paths[0][20:30]]
    downwind = [{"lat": 26.0, "lon": 80.0, "frp": 500.0, "t": time.time()}]
    fi, clusters = attribution.fire_influence(paths, upwind + downwind)
    assert fi > 0 and clusters
    assert all(c["lat"] > 27 for c in clusters)  # the downwind fire never contributes
    assert abs(sum(c["share"] for c in clusters) - 1) < 0.01


def test_apportionment_sums_to_one_and_responds_to_fire():
    calm = attribution.apportion("igp_metro", 0.0, 80, 10, 30, 10)
    smoky = attribution.apportion("igp_metro", 800.0, 80, 10, 30, 10)
    assert abs(sum(calm.values()) - 1) < 0.01 and abs(sum(smoky.values()) - 1) < 0.01
    assert smoky["biomass"] > 0.5 > calm["biomass"]


# ------------------------------------------------------------------ federated
def _toy_nodes():
    rng = np.random.default_rng(0)
    series, truth = {}, {}
    from app.registry import CITY_BY_ID
    for cid, bias in (("delhi", 0.4), ("mumbai", 0.8), ("chennai", 0.6), ("kolkata", 0.5)):
        t = [3600 * k for k in range(72)]
        pm = list(40 + 20 * np.sin(np.arange(72) / 6) + rng.normal(0, 2, 72))
        series[cid] = {"time": t, "pm25": pm, "pm10": [p * 1.7 for p in pm], "ws": [8.0] * 72, "blh": [600.0] * 72,
                       "rh": [60.0] * 72, "dust": [5.0] * 72}
        truth[cid] = {tt: p * bias for tt, p in zip(t, pm)}
        assert cid in CITY_BY_ID
    return series, truth


def test_federated_beats_raw_global_model():
    series, truth = _toy_nodes()
    m = federated.train(series, truth, rounds=25)
    s = m.summary
    assert s["nodes"] == 4
    assert s["mae_federated"] < s["mae_cams"]
    assert s["mae_personalised"] <= s["mae_federated"] + 0.5
    assert s["raw_bytes_kept_local"] > 0 and s["bytes_shared"] > 0
    assert len(m.rounds) == 25


def test_dp_noise_is_optional_and_bounded():
    series, truth = _toy_nodes()
    noisy = federated.train(series, truth, rounds=15, dp_sigma=0.05)
    assert math.isfinite(noisy.summary["mae_federated"])


# ------------------------------------------------------------------ forecast & response
def test_city_forecast_shapes_and_spike_logic():
    series = asyncio.run(datahub.city_series())
    c = forecast.build_city("delhi", series["delhi"])
    s = c["_series"]
    assert len(s["time"]) == len(s["naqi"]) and 0 <= s["now_offset"] < len(s["time"])
    assert c["naqi"] is not None and c["category"]["label"]
    if c["spike"]:
        assert c["spike"]["lead_hours"] >= 1 and c["spike"]["grap"]["stage"] >= 1


def test_response_simulator_reduces_and_is_monotone_in_compliance():
    shares = {"biomass": 0.3, "transport": 0.25, "industry": 0.15, "dust": 0.15, "residential": 0.1, "construction": 0.05}
    lo = response.simulate(120, {}, shares, ["cnd_ban", "truck_ban", "stubble_insitu"], compliance=0.4)
    hi = response.simulate(120, {}, shares, ["cnd_ban", "truck_ban", "stubble_insitu"], compliance=0.9)
    assert 0 < lo["reduction"] < hi["reduction"] < 120
    assert hi["naqi_after"] < hi["naqi_before"]
    none = response.simulate(120, {}, shares, [], compliance=0.9)
    assert none["reduction"] == 0

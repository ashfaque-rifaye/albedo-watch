"""Response simulator — what happens if the authority acts?

Each measure removes a fraction of one or more source sectors (drawn from
GRAP schedules and NCAP city action plans). Impact = Σ sector share × sector
reduction × compliance × current PM2.5. Because shares come from the live
attribution, the *same* measure is worth different amounts in different cities
on different days — which is the point.
Efficacy figures are indicative (literature-informed), labelled as such.
"""
from __future__ import annotations

from .naqi import category, naqi

MEASURES = [
    {"id": "stubble_insitu", "label": "Stubble: in-situ management + bio-decomposer drive", "grap": 1,
     "cuts": {"biomass": 0.45}, "lead_h": 48, "owner": "District Agriculture Dept + SPCB", "cost": "₹₹"},
    {"id": "fire_enforce", "label": "Satellite-triggered farm-fire enforcement squads", "grap": 1,
     "cuts": {"biomass": 0.25}, "lead_h": 12, "owner": "District Collector", "cost": "₹"},
    {"id": "cnd_ban", "label": "Halt construction & demolition (non-essential)", "grap": 2,
     "cuts": {"construction": 0.7, "dust": 0.1}, "lead_h": 6, "owner": "Municipal Corporation", "cost": "₹₹"},
    {"id": "road_dust", "label": "Mechanised sweeping + water sprinkling on arterials", "grap": 1,
     "cuts": {"dust": 0.2}, "lead_h": 6, "owner": "Municipal Corporation", "cost": "₹"},
    {"id": "truck_ban", "label": "Non-essential diesel truck entry ban", "grap": 3,
     "cuts": {"transport": 0.18}, "lead_h": 12, "owner": "Traffic Police + Transport Dept", "cost": "₹₹"},
    {"id": "wfh", "label": "50% work-from-home + staggered office hours", "grap": 3,
     "cuts": {"transport": 0.1}, "lead_h": 24, "owner": "State Government", "cost": "₹"},
    {"id": "industry_fuel", "label": "Shut non-PNG industries / coal-fired units", "grap": 3,
     "cuts": {"industry": 0.35}, "lead_h": 24, "owner": "State Pollution Control Board", "cost": "₹₹₹"},
    {"id": "dg_sets", "label": "Ban diesel generator sets (except essential)", "grap": 2,
     "cuts": {"industry": 0.06, "residential": 0.05}, "lead_h": 6, "owner": "SPCB + DISCOMs", "cost": "₹"},
    {"id": "waste_burn", "label": "Open waste-burning patrols + night enforcement", "grap": 1,
     "cuts": {"residential": 0.3}, "lead_h": 12, "owner": "Municipal Corporation", "cost": "₹"},
    {"id": "schools", "label": "Shift schools to hybrid (exposure, not emissions)", "grap": 4,
     "cuts": {}, "lead_h": 12, "owner": "Education Dept", "cost": "₹", "exposure_only": True},
]
BY_ID = {m["id"]: m for m in MEASURES}


def simulate(pm25: float, other: dict, shares: dict[str, float], measure_ids: list[str],
             compliance: float = 0.7, pop_m: float = 1.0) -> dict:
    remaining = dict(shares)
    rows = []
    for mid in measure_ids:
        m = BY_ID.get(mid)
        if not m:
            continue
        before = sum(remaining.values())
        for sector, cut in m["cuts"].items():
            if sector in remaining:
                remaining[sector] *= 1 - cut * compliance
        delta = (before - sum(remaining.values())) * pm25
        rows.append({"id": mid, "label": m["label"], "owner": m["owner"], "lead_h": m["lead_h"],
                     "ugm3": round(delta, 1), "exposure_only": m.get("exposure_only", False)})
    after = pm25 * sum(remaining.values())
    idx_before, _ = naqi({"pm25": pm25, **other})
    idx_after, _ = naqi({"pm25": after, **other})
    reduction = pm25 - after
    # Health framing: ~1% all-cause mortality risk per 10 µg/m³ PM2.5 (GBD-style
    # log-linear slope, indicative) — expressed as person-days of cleaner air.
    return {
        "pm25_before": round(pm25, 1), "pm25_after": round(after, 1), "reduction": round(reduction, 1),
        "reduction_pct": round(100 * reduction / pm25, 1) if pm25 else 0,
        "naqi_before": idx_before, "naqi_after": idx_after,
        "category_before": category(idx_before), "category_after": category(idx_after),
        "measures": rows, "compliance": compliance,
        "people_benefiting_m": round(pop_m, 1),
        "risk_reduction_pct": round(min(30.0, reduction / 10 * 1.0), 2),
        "caveat": "Indicative: sector efficacies from GRAP/NCAP literature; real effect depends on enforcement and weather.",
    }

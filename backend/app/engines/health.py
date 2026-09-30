"""What cleaner air is worth — indicative health and economic value of a PM2.5 reduction.

Short-term (episode) effects only, using published concentration–response functions:
* all-cause mortality: +0.65 % per 10 µg/m³ PM2.5 (Orellano et al. 2020, WHO systematic review)
* respiratory hospital admissions: +1.9 % per 10 µg/m³ PM2.5 (WHO HRAPIE)
Baselines and money values are illustrative and labelled as such in the UI.
"""
from __future__ import annotations

import math

MORT_PER_10 = 0.0065
RESP_PER_10 = 0.019
CRUDE_DEATH_RATE = {"IN": 6.0}          # per 1,000 per year (India SRS 2020); world ≈ 7.6
RESP_ADMISSIONS_PER_100K = 1165         # per year (HRAPIE baseline, indicative)
VSL = {"IN": (4.0e7, "₹", "crore", 1e7)}  # ₹4 crore ≈ US$0.48 M (income-adjusted benefit transfer, illustrative)
VSL_DEFAULT = (1.0e6, "US$", "M", 1e6)
ADMISSION_COST = {"IN": 30_000}          # ₹ per respiratory admission (illustrative)
ADMISSION_COST_DEFAULT = 4_000           # US$


def impact(delta_pm25: float, pop_m: float, days: float = 3, country: str = "IN") -> dict:
    pop = max(0.0, pop_m) * 1e6
    d = max(0.0, delta_pm25)
    daily_deaths = pop * CRUDE_DEATH_RATE.get(country, 7.6) / 1000 / 365
    deaths = daily_deaths * days * (1 - math.exp(-math.log(1 + MORT_PER_10) * d / 10))
    daily_adm = pop * RESP_ADMISSIONS_PER_100K / 1e5 / 365
    admissions = daily_adm * days * (1 - math.exp(-math.log(1 + RESP_PER_10) * d / 10))
    vsl, cur, unit, div = VSL.get(country, VSL_DEFAULT)
    adm_cost = ADMISSION_COST.get(country, ADMISSION_COST_DEFAULT)
    value = deaths * vsl + admissions * adm_cost
    return {
        "days": days, "delta_pm25": round(d, 1),
        "deaths_avoided": round(deaths, 1), "admissions_avoided": round(admissions),
        "value": round(value / div, 1), "currency": cur, "unit": unit,
        "method": "Short-term effects over the episode: +0.65% deaths and +1.9% respiratory admissions per 10 µg/m³ PM2.5 "
                  "(WHO review, HRAPIE); money values use an illustrative value of statistical life. Estimates, not predictions.",
    }

"""Model Commons — federated learning across state nodes.

Problem: global forecasts (CAMS, ~40 km) systematically miss India's local
reality — in either direction, differently in every airshed. Each state holds
its own ground truth (here: Google AQ station-fused PM2.5) and must not be
forced to pool raw data. So:

* every state node fits a local bias-correction model on its own data,
* only model weights (8 floats) travel; raw observations never leave the node,
* the coordinator runs FedAvg (McMahan et al., 2017) weighted by sample count,
* nodes personalise the global model with a few local epochs (FedPer-style),
* optional Gaussian noise on shared updates (DP-style) for sovereign deployments.

Leave-one-state-out evaluation answers the policy question directly:
*does a state with zero monitoring data still get a better forecast?*
"""
from __future__ import annotations

import logging
import math
import time
from dataclasses import dataclass, field

import numpy as np

from ..registry import CITY_BY_ID, WORLD_COUNTRIES, node_authority, node_name, node_of
from . import datahub

log = logging.getLogger("albedo.federated")

FEATURES = ["bias", "log CAMS PM2.5", "wind speed", "mixing height", "humidity", "hour (sin)", "hour (cos)", "dust fraction"]
HOLDOUT_H = 18


def featurize(s: dict, k: int) -> np.ndarray | None:
    pm = s["pm25"][k]
    if pm is None:
        return None
    ws = s["ws"][k] if s["ws"][k] is not None else 8.0
    blh = s["blh"][k] if s["blh"][k] is not None else 500.0
    rh = s["rh"][k] if s["rh"][k] is not None else 60.0
    dust, pm10 = s["dust"][k] or 0.0, s["pm10"][k] or pm
    hour = (s["time"][k] // 3600 + 5.5) % 24  # IST hour of day
    return np.array([
        1.0, math.log1p(pm), ws / 10.0, math.log1p(blh) / 7.0, rh / 100.0,
        math.sin(2 * math.pi * hour / 24), math.cos(2 * math.pi * hour / 24), dust / (pm10 + 1.0),
    ])


@dataclass
class Node:
    state: str
    cities: list[str]
    X: np.ndarray
    y: np.ndarray
    raw: np.ndarray          # CAMS PM2.5 (µg/m³) for the same samples — the baseline
    truth: np.ndarray        # observed PM2.5 (µg/m³)
    n_train: int = 0

    @property
    def n(self) -> int:
        return len(self.y)


def region_of(node: str) -> str:
    """Federation a node belongs to: India's states federate together; other countries
    federate within their world region (biases are regional, not planetary)."""
    if node.startswith("IN-"):
        return "India"
    c = WORLD_COUNTRIES.get(node)
    return c.region if c else "Global"


@dataclass
class CommonsModel:
    global_w: np.ndarray
    personal: dict[str, np.ndarray]
    regional: dict[str, np.ndarray] = field(default_factory=dict)
    rounds: list[dict] = field(default_factory=list)
    nodes: list[dict] = field(default_factory=list)
    summary: dict = field(default_factory=dict)
    trained_at: float = 0.0
    config: dict = field(default_factory=dict)

    def weights_for(self, state: str) -> tuple[np.ndarray, str]:
        if state in self.personal:
            return self.personal[state], "personalised"
        reg = self.regional.get(region_of(state))
        if reg is not None:
            return reg, "federated-global"
        return self.global_w, "federated-global"


def _build_nodes(series: dict, truth: dict) -> list[Node]:
    by_state: dict[str, list[str]] = {}
    for cid in truth:
        by_state.setdefault(node_of(CITY_BY_ID[cid]), []).append(cid)
    nodes = []
    for st, cids in sorted(by_state.items()):
        X, y, raw, obs = [], [], [], []
        for cid in cids:
            s, tr = series.get(cid), truth[cid]
            if not s:
                continue
            idx = {t: k for k, t in enumerate(s["time"])}
            for t in sorted(tr):
                k = idx.get(t)
                if k is None or tr[t] is None or tr[t] < 0:
                    continue
                x = featurize(s, k)
                if x is None:
                    continue
                X.append(x); y.append(math.log1p(tr[t])); raw.append(s["pm25"][k]); obs.append(tr[t])
        if len(y) >= 24:
            nodes.append(Node(st, cids, np.array(X), np.array(y), np.array(raw), np.array(obs),
                              n_train=len(y) - HOLDOUT_H))
    return nodes


def _sgd(w: np.ndarray, X: np.ndarray, y: np.ndarray, epochs: int, lr: float, l2: float) -> np.ndarray:
    w = w.copy()
    n = max(1, len(y))
    for _ in range(epochs):
        grad = X.T @ (X @ w - y) / n + l2 * w
        g = float(np.linalg.norm(grad))
        if g > 5.0:  # gradient clipping keeps every node stable, whatever its data looks like
            grad *= 5.0 / g
        w -= lr * grad
    return w


def _predict(X: np.ndarray, w: np.ndarray) -> np.ndarray:
    return np.expm1(np.clip(X @ w, -5.0, 7.5))  # log-space clamp: ≤ ~1800 µg/m³


def _mae(w: np.ndarray, node: Node, holdout: bool = True) -> float:
    sl = slice(node.n_train, None) if holdout else slice(None)
    pred = _predict(node.X[sl], w)
    return float(np.mean(np.abs(pred - node.truth[sl])))


def _raw_mae(node: Node, holdout: bool = True) -> float:
    sl = slice(node.n_train, None) if holdout else slice(None)
    return float(np.mean(np.abs(node.raw[sl] - node.truth[sl])))


def _w0() -> np.ndarray:
    w = np.zeros(len(FEATURES))
    w[1] = 1.0  # start at identity: "trust CAMS"
    return w


def fedavg(nodes: list[Node], rounds: int, local_epochs: int, lr: float, l2: float,
           dp_sigma: float = 0.0, rng: np.random.Generator | None = None,
           track: bool = False) -> tuple[np.ndarray, list[dict]]:
    rng = rng or np.random.default_rng(7)
    w = _w0()
    history = []
    for r in range(1, rounds + 1):
        updates, weights = [], []
        for nd in nodes:
            Xt, yt = nd.X[:nd.n_train], nd.y[:nd.n_train]
            wl = _sgd(w, Xt, yt, local_epochs, lr, l2)
            delta = wl - w
            if dp_sigma > 0:
                norm = np.linalg.norm(delta)
                delta = delta / max(1.0, norm / 1.0)                      # clip to L2 ≤ 1
                delta = delta + rng.normal(0, dp_sigma, size=delta.shape)  # Gaussian mechanism
            updates.append(delta); weights.append(nd.n_train)
        w = w + np.average(np.array(updates), axis=0, weights=np.array(weights, dtype=float))
        if track:
            maes = [_mae(w, nd) for nd in nodes]
            history.append({"round": r, "mae": round(float(np.average(maes, weights=[nd.n for nd in nodes])), 2)})
    return w, history


def train(series: dict, truth: dict, rounds: int = 30, local_epochs: int = 15, lr: float = 0.08,
          l2: float = 1e-3, dp_sigma: float = 0.0, personalise_epochs: int = 4) -> CommonsModel:
    nodes = _build_nodes(series, truth)
    if len(nodes) < 2:
        raise RuntimeError("need ≥2 nodes with ground truth")
    t0 = time.perf_counter()
    gw, _ = fedavg(nodes, rounds, local_epochs, lr, l2, dp_sigma)          # planetary fallback

    groups: dict[str, list[Node]] = {}
    for nd in nodes:
        groups.setdefault(region_of(nd.state), []).append(nd)
    regional: dict[str, np.ndarray] = {}
    per_round: dict[int, list[tuple[float, int]]] = {}
    for reg, members in groups.items():
        if len(members) < 2:
            continue
        w, hist = fedavg(members, rounds, local_epochs, lr, l2, dp_sigma, track=True)
        regional[reg] = w
        n = sum(m.n for m in members)
        for h in hist:
            per_round.setdefault(h["round"], []).append((h["mae"], n))
    history = [{"round": r, "mae": round(sum(m * n for m, n in v) / sum(n for _, n in v), 2)} for r, v in sorted(per_round.items())]

    def model_for(nd: Node) -> np.ndarray:
        return regional.get(region_of(nd.state), gw)

    personal = {nd.state: _sgd(model_for(nd), nd.X[:nd.n_train], nd.y[:nd.n_train], personalise_epochs, lr, l2) for nd in nodes}

    node_rows = []
    for nd in nodes:
        reg = region_of(nd.state)
        local_only = _sgd(_w0(), nd.X[:nd.n_train], nd.y[:nd.n_train], rounds * local_epochs, lr, l2)
        # zero-data test: the node's federation trained WITHOUT it, applied to it
        peers = [o for o in groups.get(reg, []) if o is not nd]
        pool = peers if len(peers) >= 1 else [o for o in nodes if o is not nd]
        loso_w, _ = fedavg(pool, max(10, rounds // 2), local_epochs, lr, l2, dp_sigma)
        node_rows.append({
            "state": nd.state, "name": node_name(nd.state), "authority": node_authority(nd.state),
            "india": nd.state.startswith("IN-"), "federation": reg if reg in regional else "Global",
            "cities": [CITY_BY_ID[c].name for c in nd.cities], "samples": nd.n,
            "lat": float(np.mean([CITY_BY_ID[c].lat for c in nd.cities])),
            "lon": float(np.mean([CITY_BY_ID[c].lon for c in nd.cities])),
            "mae_cams": round(_raw_mae(nd), 2),
            "mae_local": round(_mae(local_only, nd), 2),
            "mae_global": round(_mae(gw, nd), 2),
            "mae_federated": round(_mae(model_for(nd), nd), 2),
            "mae_personalised": round(_mae(personal[nd.state], nd), 2),
            "mae_zero_data": round(_mae(loso_w, nd), 2),
            "bias_cams": round(float(np.mean(nd.raw - nd.truth)), 1),
            "mean_truth": round(float(np.mean(nd.truth)), 1),
        })

    def avg(key: str, rows=None) -> float:
        rows = rows or node_rows
        return round(float(np.average([r[key] for r in rows], weights=[r["samples"] for r in rows])), 2)

    raw_bytes = sum(nd.n * (len(FEATURES) + 1) * 8 for nd in nodes)
    shared_bytes = rounds * len(nodes) * len(FEATURES) * 8 * 2
    india_rows = [r for r in node_rows if r["india"]]
    summary = {
        "nodes": len(nodes), "samples": sum(nd.n for nd in nodes), "rounds": rounds,
        "federations": {reg: len(m) for reg, m in groups.items() if reg in regional},
        "mae_cams": avg("mae_cams"), "mae_local": avg("mae_local"), "mae_global": avg("mae_global"),
        "mae_federated": avg("mae_federated"), "mae_personalised": avg("mae_personalised"), "mae_zero_data": avg("mae_zero_data"),
        "india": ({k: avg(k, india_rows) for k in ("mae_cams", "mae_local", "mae_federated", "mae_personalised", "mae_zero_data")}
                  | {"nodes": len(india_rows)}) if india_rows else None,
        "raw_bytes_kept_local": raw_bytes, "bytes_shared": shared_bytes,
        "train_ms": round((time.perf_counter() - t0) * 1000),
        "dp_sigma": dp_sigma,
    }
    for k, v in list(summary.items()):
        if isinstance(v, float) and not math.isfinite(v):
            summary[k] = None
    for r in node_rows:
        for k, v in list(r.items()):
            if isinstance(v, float) and not math.isfinite(v):
                r[k] = None
    if summary["mae_federated"] is None or summary["mae_cams"] is None:
        raise RuntimeError("federated training diverged")
    base = max(summary["mae_cams"], 1e-6)
    summary["improvement_pct"] = round(100 * (1 - summary["mae_personalised"] / base), 1)
    summary["federated_improvement_pct"] = round(100 * (1 - summary["mae_federated"] / base), 1)
    summary["zero_data_improvement_pct"] = round(100 * (1 - (summary["mae_zero_data"] or base) / base), 1)
    return CommonsModel(
        global_w=gw, personal=personal, regional=regional, rounds=history, nodes=node_rows, summary=summary,
        trained_at=time.time(),
        config={"rounds": rounds, "local_epochs": local_epochs, "lr": lr, "l2": l2, "dp_sigma": dp_sigma,
                "topology": "regional FedAvg federations + per-node personalisation; planetary model as fallback"},
    )


_model: CommonsModel | None = None


async def ensure_model(force: bool = False, **kw) -> CommonsModel | None:
    global _model
    if _model is not None and not force and time.time() - _model.trained_at < 6 * 3600:
        return _model
    try:
        series, tr = await datahub.city_series(), await datahub.truth()
        import asyncio
        _model = await asyncio.to_thread(train, series, tr, **kw)
        log.info("commons trained: %s", _model.summary)
    except Exception as exc:
        log.warning("federated training unavailable (%s: %s)", type(exc).__name__, exc)
    return _model


def current() -> CommonsModel | None:
    return _model


def correct(state: str, s: dict, k: int) -> tuple[float | None, str]:
    """Bias-corrected PM2.5 for one hour of a city series."""
    raw = s["pm25"][k]
    if _model is None or raw is None:
        return raw, "cams-raw"
    x = featurize(s, k)
    if x is None:
        return raw, "cams-raw"
    w, kind = _model.weights_for(state)
    val = float(_predict(x[None, :], w)[0])
    # guard rails: corrections stay within a plausible band of the physical model
    return max(0.0, min(val, raw * 4 + 50)), kind


def model_card() -> dict:
    m = _model
    if m is None:
        return {"status": "training-pending"}
    return {
        "name": "Albedo-Watch PM2.5 bias-correction (federated linear, log-space)",
        "protocol": "Regional FedAvg federations + per-node personalisation", "features": FEATURES,
        "regional_weights": {k: [round(float(x), 5) for x in v] for k, v in m.regional.items()},
        "global_weights": [round(float(v), 5) for v in m.global_w],
        "config": m.config, "summary": m.summary, "trained_at": m.trained_at,
        "license": "CC-BY-4.0 (weights) — intended as a Digital Public Good",
        "intended_use": "Correct global CAMS PM2.5 forecasts toward local station reality — Indian states and countries worldwide.",
        "limitations": "72 h training window per node; linear model; Google AQ history used as station-fused truth proxy.",
    }

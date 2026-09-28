"""Persistence for citizen reports and authority alerts.

Firestore when reachable (Cloud Run, ADC), otherwise process memory — the app
never fails because persistence is down.
"""
from __future__ import annotations

import logging
import threading
import time
import uuid
from typing import Any

from .config import settings

log = logging.getLogger("albedo.store")


class Store:
    def __init__(self) -> None:
        self._mem: dict[str, dict[str, dict]] = {"reports": {}, "alerts": {}}
        self._lock = threading.Lock()
        self._fs = None
        self.backend = "memory"
        if settings.report_store in ("auto", "firestore") and settings.gcp_project and not settings.offline:
            try:
                from google.cloud import firestore  # type: ignore
                self._fs = firestore.Client(project=settings.gcp_project)
                list(self._fs.collection("reports").limit(1).stream())  # probe
                self.backend = "firestore"
            except Exception as exc:
                log.info("firestore unavailable (%s) — using memory store", type(exc).__name__)
                self._fs = None

    def put(self, coll: str, doc: dict) -> dict:
        doc.setdefault("id", uuid.uuid4().hex[:10])
        doc.setdefault("created_at", time.time())
        doc["updated_at"] = time.time()
        with self._lock:
            self._mem[coll][doc["id"]] = doc
        if self._fs is not None:
            try:
                self._fs.collection(coll).document(doc["id"]).set(doc)
            except Exception as exc:
                log.warning("firestore write failed (%s)", type(exc).__name__)
        return doc

    def get(self, coll: str, doc_id: str) -> dict | None:
        with self._lock:
            if doc_id in self._mem[coll]:
                return self._mem[coll][doc_id]
        if self._fs is not None:
            try:
                snap = self._fs.collection(coll).document(doc_id).get()
                if snap.exists:
                    return snap.to_dict()
            except Exception:
                pass
        return None

    def list(self, coll: str, limit: int = 200, since: float | None = None) -> list[dict[str, Any]]:
        if self._fs is not None:
            try:
                q = self._fs.collection(coll).order_by("created_at", direction="DESCENDING").limit(limit)
                docs = [d.to_dict() for d in q.stream()]
                with self._lock:
                    for d in docs:
                        self._mem[coll].setdefault(d["id"], d)
            except Exception as exc:
                log.warning("firestore list failed (%s)", type(exc).__name__)
        with self._lock:
            docs = sorted(self._mem[coll].values(), key=lambda d: -d.get("created_at", 0))
        if since is not None:
            docs = [d for d in docs if d.get("created_at", 0) >= since]
        return docs[:limit]


    # ---- compressed snapshots (instant cold starts) ------------------------ #
    def put_blob(self, name: str, data: dict) -> None:
        import gzip
        import json
        raw = gzip.compress(json.dumps(data, separators=(",", ":"), default=str).encode("utf-8"))
        with self._lock:
            self._mem.setdefault("snapshots", {})[name] = {"id": name, "data": raw}
        if self._fs is not None and len(raw) < 900_000:
            try:
                self._fs.collection("snapshots").document(name).set({"data": raw, "at": time.time()})
            except Exception as exc:
                log.warning("snapshot write failed (%s)", type(exc).__name__)

    def get_blob(self, name: str) -> dict | None:
        import gzip
        import json
        raw = None
        with self._lock:
            hit = self._mem.get("snapshots", {}).get(name)
            if hit:
                raw = hit["data"]
        if raw is None and self._fs is not None:
            try:
                snap = self._fs.collection("snapshots").document(name).get()
                if snap.exists:
                    raw = snap.to_dict().get("data")
            except Exception:
                return None
        if not raw:
            return None
        try:
            return json.loads(gzip.decompress(raw))
        except Exception:
            return None


store = Store()

"""Tests run fully offline: no network, no AI keys, deterministic synthetic data."""
import os
import sys
from pathlib import Path

os.environ.update({
    "OFFLINE": "true", "GEMINI_API_KEY": "", "GROQ_API_KEY": "", "GROQ_API_KEY2": "", "CEREBRAS_API_KEY": "",
    "SERVER_API_KEY": "", "GOOGLE_MAPS_API_KEY": "", "GCP_PROJECT": "", "REPORT_STORE": "memory",
    "RATE_LIMIT_PER_MINUTE": "10000",
})
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402


@pytest.fixture(scope="session")
def client():
    from app.main import app
    with TestClient(app) as c:
        yield c

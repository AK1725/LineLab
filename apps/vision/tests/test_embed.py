import math
import os

import pytest
from fastapi.testclient import TestClient

from app import embed as embedding
from app.main import app

# Needs the bge-small model (downloaded on first use, ~65 MB). Skipped when it can't be fetched.
try:
    embedding.model()
    HAVE_MODEL = True
except Exception:
    HAVE_MODEL = False

# CI sets LINELAB_REQUIRE_EMBED_MODEL=1 so a download problem fails instead of skipping.
if not HAVE_MODEL and os.environ.get("LINELAB_REQUIRE_EMBED_MODEL") == "1":
    raise RuntimeError("bge-small could not be loaded (LINELAB_REQUIRE_EMBED_MODEL=1)")
pytestmark = pytest.mark.skipif(not HAVE_MODEL, reason="embedding model not available offline")


def cos(a: list[float], b: list[float]) -> float:
    return sum(x * y for x, y in zip(a, b, strict=True))


def test_vectors_are_unit_length_and_384_wide() -> None:
    r = TestClient(app).post("/embed", json={"texts": ["robot oscillates on curves"]})
    assert r.status_code == 200
    body = r.json()
    assert body["model"] == "BAAI/bge-small-en-v1.5" and body["dim"] == 384
    v = body["vectors"][0]
    assert len(v) == 384
    assert math.isclose(math.sqrt(sum(x * x for x in v)), 1.0, rel_tol=1e-3)


def test_meaning_not_words() -> None:
    """A paraphrase with no words in common ranks above an unrelated case."""
    client = TestClient(app)
    q = client.post(
        "/embed", json={"texts": ["my bot wobbles side to side"], "kind": "query"}
    ).json()["vectors"][0]
    docs = client.post(
        "/embed",
        json={
            "texts": [
                "Kp is too high: the steering overcorrects and the robot oscillates.",
                "PWMA is pin 6 but the driver is wired to D3: the left motor gets no speed signal.",
            ]
        },
    ).json()["vectors"]
    assert cos(q, docs[0]) > cos(q, docs[1]) + 0.05


def test_limits() -> None:
    client = TestClient(app)
    assert client.post("/embed", json={"texts": []}).status_code == 422
    assert client.post("/embed", json={"texts": ["x"] * 65}).status_code == 422

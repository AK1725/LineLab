from pathlib import Path

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.robot_outline import OutlineError, robot_outline


def _photo(seed: int) -> tuple[bytes, np.ndarray, tuple[int, int]]:
    """A floor with a lighting gradient and noise, and a robot: plate, two wheels, a board."""
    rng = np.random.default_rng(seed)
    h, w = 900, 700
    yy, xx = np.mgrid[0:h, 0:w]
    floor = (200 + 30 * xx / w - 20 * yy / h)[..., None] * np.array([1.0, 0.97, 0.92])
    img = floor + rng.normal(0, 4, (h, w, 3))
    plate = np.array(
        [[250, 180], [450, 180], [480, 260], [480, 700], [220, 700], [220, 260]], np.int32
    )
    plate = (plate + rng.integers(-20, 20, 2)).astype(np.int32)
    truth = np.zeros((h, w), np.uint8)
    cv2.fillPoly(truth, [plate], 255)
    cv2.fillPoly(img, [plate], (60, 120, 40))  # green PCB
    for x0 in (170, 480):
        cv2.rectangle(img, (x0, 520), (x0 + 50, 640), (25, 25, 25), -1)  # wheels
        cv2.rectangle(truth, (x0, 520), (x0 + 50, 640), 255, -1)
    cv2.rectangle(img, (280, 300), (420, 380), (160, 90, 30), -1)  # blue board
    ok, jpg = cv2.imencode(
        ".jpg", np.clip(img, 0, 255).astype(np.uint8), [cv2.IMWRITE_JPEG_QUALITY, 85]
    )
    assert ok
    return jpg.tobytes(), truth, (w, h)


def _iou(poly: list[tuple[float, float]], truth: np.ndarray, size: tuple[int, int]) -> float:
    w, h = size
    pred = np.zeros_like(truth)
    pts = np.array([[x * w, y * h] for x, y in poly], np.int32)
    cv2.fillPoly(pred, [pts], 255)
    inter = np.logical_and(pred > 0, truth > 0).sum()
    union = np.logical_or(pred > 0, truth > 0).sum()
    return float(inter / union)


@pytest.mark.parametrize("seed", [1, 2, 3, 4, 5])
def test_silhouette_matches_the_robot(seed: int) -> None:
    jpg, truth, size = _photo(seed)
    out = robot_outline(jpg)
    assert _iou(out.polygon, truth, size) > 0.93
    assert 3 <= len(out.polygon) <= 40
    assert out.contrast > 10


def test_rejects_an_empty_floor() -> None:
    img = np.full((400, 400, 3), 200, np.uint8)
    ok, png = cv2.imencode(".png", img)
    assert ok
    with pytest.raises(OutlineError):
        robot_outline(png.tobytes())


def test_route() -> None:
    jpg, _, _ = _photo(7)
    client = TestClient(app)
    r = client.post("/robot/outline", files={"file": ("top.jpg", jpg, "image/jpeg")})
    assert r.status_code == 200
    body = r.json()
    assert body["width_px"] == 700 and len(body["polygon"]) >= 3
    bad = client.post("/robot/outline", files={"file": ("x.png", b"not an image", "image/png")})
    assert bad.status_code == 422


FIXTURES = Path(__file__).resolve().parents[3] / "packages" / "photo-design" / "fixtures"


@pytest.mark.parametrize(
    "fixture",
    [
        "nano-tb6612-qtr8a",
        "uno-l9110s-tt",
        "esp32-drv8833-qtr8rc",
        "pico-drv8835-qtrmd",
        "promini-mx1508-tcrt8",
    ],
)
def test_fixture_renders(fixture: str) -> None:
    """Flat-colour LineLab renders: the truth is every non-floor pixel (label excluded)."""
    data = (FIXTURES / fixture / "top.png").read_bytes()
    decoded = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    assert decoded is not None
    img = decoded.astype(np.int32)
    h, w = img.shape[:2]
    truth = (np.abs(img - img[2, 2]).sum(axis=2) > 30).astype(np.uint8) * 255
    truth[h - 30 :] = 0
    out = robot_outline(data)
    assert _iou(out.polygon, truth, (w, h)) > 0.9

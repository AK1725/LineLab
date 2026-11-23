"""Test helpers: sample LineLab track JSON and render synthetic photos of it."""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from numpy.typing import NDArray

TRACKS = Path(__file__).resolve().parents[3] / "tracks"


def load(track_id: str) -> dict[str, Any]:
    data: dict[str, Any] = json.loads((TRACKS / f"{track_id}.json").read_text())
    return data


def centreline(track: dict[str, Any], step: float = 1.0) -> NDArray[np.float64]:
    pts: list[tuple[float, float]] = []
    for s in track["segments"]:
        if s["type"] == "line":
            a, b = s["from"], s["to"]
            n = max(1, math.ceil(math.hypot(b["x"] - a["x"], b["y"] - a["y"]) / step))
            pts += [
                (a["x"] + (b["x"] - a["x"]) * i / n, a["y"] + (b["y"] - a["y"]) * i / n)
                for i in range(n + 1)
            ]
        elif s["type"] == "arc":
            n = max(2, math.ceil(abs(s["sweepRad"]) * s["radiusMm"] / step))
            for i in range(n + 1):
                t = s["startAngleRad"] + s["sweepRad"] * i / n
                pts.append(
                    (
                        s["center"]["x"] + s["radiusMm"] * math.cos(t),
                        s["center"]["y"] + s["radiusMm"] * math.sin(t),
                    )
                )
        else:
            p0, p1, p2, p3 = (s[k] for k in ("p0", "p1", "p2", "p3"))
            for i in range(201):
                t = i / 200
                u = 1 - t
                pts.append(
                    (
                        u**3 * p0["x"]
                        + 3 * u * u * t * p1["x"]
                        + 3 * u * t * t * p2["x"]
                        + t**3 * p3["x"],
                        u**3 * p0["y"]
                        + 3 * u * u * t * p1["y"]
                        + 3 * u * t * t * p2["y"]
                        + t**3 * p3["y"],
                    )
                )
    return np.array(pts, dtype=np.float64)


def photo(
    track: dict[str, Any], *, px_per_mm: float = 1.0, margin_mm: float = 80.0, seed: int = 0
) -> tuple[bytes, list[tuple[float, float]], float, float, NDArray[np.float64]]:
    """A synthetic 'phone photo' of the track: top-down render, then a perspective tilt,
    a lighting gradient, noise, blur and JPEG compression.

    Returns (jpeg bytes, corners of the rendered sheet in the photo, sheet width/height in mm,
    true centreline in sheet coordinates with y up).
    """
    rng = np.random.default_rng(seed)
    c = centreline(track)
    x0, y0 = c.min(axis=0) - margin_mm
    x1, y1 = c.max(axis=0) + margin_mm
    w_mm, h_mm = float(x1 - x0), float(y1 - y0)
    w, h = round(w_mm * px_per_mm), round(h_mm * px_per_mm)
    sheet = np.full((h, w), 235, np.uint8)
    pix = np.stack([(c[:, 0] - x0) * px_per_mm, (h_mm - (c[:, 1] - y0)) * px_per_mm], axis=1)
    thick = max(1, round(track["lineWidthMm"] * px_per_mm))
    cv2.polylines(sheet, [pix.astype(np.int32).reshape(-1, 1, 2)], False, 25, thick, cv2.LINE_AA)
    for f in track["features"]:
        if f["type"] == "gap":
            pass  # gaps are not used by these tests
    # Perspective: move each corner inwards by up to 8 % of the sheet size.
    jit = rng.uniform(0.0, 0.08, size=(4, 2)) * np.array([w, h])
    pad = 60
    src = np.array([[0, 0], [w - 1, 0], [w - 1, h - 1], [0, h - 1]], np.float32)
    dst = np.array(
        [
            [pad + jit[0, 0], pad + jit[0, 1]],
            [pad + w - 1 - jit[1, 0], pad + jit[1, 1]],
            [pad + w - 1 - jit[2, 0], pad + h - 1 - jit[2, 1]],
            [pad + jit[3, 0], pad + h - 1 - jit[3, 1]],
        ],
        np.float32,
    )
    m = cv2.getPerspectiveTransform(src, dst)
    img = cv2.warpPerspective(sheet, m, (w + 2 * pad, h + 2 * pad), borderValue=120)
    # Uneven lighting, noise, blur.
    yy, xx = np.mgrid[0 : img.shape[0], 0 : img.shape[1]]
    gradient = 0.75 + 0.35 * (xx / img.shape[1]) - 0.1 * (yy / img.shape[0])
    img = np.clip(img * gradient + rng.normal(0, 6, img.shape), 0, 255).astype(np.uint8)
    img = cv2.GaussianBlur(img, (3, 3), 0)
    ok, jpg = cv2.imencode(
        ".jpg", cv2.cvtColor(img, cv2.COLOR_GRAY2BGR), [cv2.IMWRITE_JPEG_QUALITY, 85]
    )
    assert ok
    truth = np.stack([c[:, 0] - x0, c[:, 1] - y0], axis=1)
    return jpg.tobytes(), [(float(x), float(y)) for x, y in dst], w_mm, h_mm, truth


def mean_distance(a: NDArray[np.float64], b: NDArray[np.float64]) -> float:
    """Mean distance from each point of a to its nearest point of b."""
    out = []
    for chunk in np.array_split(a, max(1, len(a) // 500)):
        d = np.sqrt(((chunk[:, None, :] - b[None, :, :]) ** 2).sum(axis=2))
        out.append(d.min(axis=1))
    return float(np.concatenate(out).mean())

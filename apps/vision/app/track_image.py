"""Photo or scan of a line-following track -> LineLab Track JSON.

Pipeline: (optional) perspective correction -> illumination correction -> Otsu threshold ->
clean-up -> skeleton -> graph tracing -> spur pruning -> simplification -> track segments.

Coordinates in the result are millimetres with y pointing up (image rows are flipped).
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from itertools import pairwise
from typing import Any

import cv2
import numpy as np
from numpy.typing import NDArray
from skimage.morphology import skeletonize

WORK_PX_PER_MM = 2.0  # resolution after perspective correction (0.5 mm per pixel)

Img = NDArray[Any]
Corners = tuple[tuple[float, float], tuple[float, float], tuple[float, float], tuple[float, float]]


def px(v: float) -> int:
    """Nearest pixel index."""
    return round(float(v))


class TrackImageError(ValueError):
    """The image could not be turned into a track; the message is shown to the user."""


@dataclass
class Calibration:
    """Either a known scale for a top-down scan, or four corners of a known rectangle.

    corners: pixel coordinates of the rectangle's top-left, top-right, bottom-right and
    bottom-left corners in the photo; width_mm/height_mm: its real size.
    """

    mm_per_px: float | None = None
    corners: Corners | None = None
    width_mm: float | None = None
    height_mm: float | None = None

    def validate(self) -> None:
        if self.corners is not None:
            if not self.width_mm or not self.height_mm or self.width_mm <= 0 or self.height_mm <= 0:
                raise TrackImageError(
                    "Give the real width and height (mm) of the rectangle you marked."
                )
        elif self.mm_per_px is None or self.mm_per_px <= 0:
            raise TrackImageError(
                "Give a scale (mm per pixel) or mark four corners of a known rectangle."
            )


@dataclass
class Diagnostics:
    mm_per_px: float
    line_width_mm: float
    paths: int
    junctions: int
    length_mm: float
    confidence: float
    warnings: list[str] = field(default_factory=list)


def _rectify(img: Img, cal: Calibration) -> tuple[Img, float]:
    if cal.corners is None:
        return img, float(cal.mm_per_px or 1.0)
    w = round((cal.width_mm or 0) * WORK_PX_PER_MM)
    h = round((cal.height_mm or 0) * WORK_PX_PER_MM)
    if w * h > 40_000_000:
        raise TrackImageError(
            "The marked area is too large; mark a smaller rectangle or use a scale."
        )
    src = np.array(cal.corners, dtype=np.float32)
    dst = np.array([[0, 0], [w - 1, 0], [w - 1, h - 1], [0, h - 1]], dtype=np.float32)
    m = cv2.getPerspectiveTransform(src, dst)
    out = cv2.warpPerspective(
        img, m, (w, h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE
    )
    return out, 1.0 / WORK_PX_PER_MM


def _line_mask(gray: Img, mm_per_px: float) -> tuple[Img, bool]:
    # Illumination correction: divide by a heavy blur so shadows and gradients flatten out.
    sigma = max(5.0, 40.0 / mm_per_px)
    background = cv2.GaussianBlur(gray.astype(np.float32), (0, 0), sigma) + 1.0
    flat = gray.astype(np.float32) / background
    flat8: Img = cv2.normalize(flat, None, 0, 255, cv2.NORM_MINMAX).astype(np.uint8)
    smooth: Img = cv2.GaussianBlur(flat8, (5, 5), 0)
    _, binary = cv2.threshold(smooth, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    dark = binary == 0
    # The line is the minority class (it covers less of the image than the floor).
    line_is_dark = bool(dark.mean() < 0.5)
    mask = (dark if line_is_dark else ~dark).astype(np.uint8) * 255
    k = max(3, round(1.5 / mm_per_px)) | 1
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=2)
    # Drop specks smaller than ~40 mm².
    n, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    min_area = 40.0 / (mm_per_px * mm_per_px)
    keep = np.zeros(n, dtype=bool)
    keep[1:] = stats[1:, cv2.CC_STAT_AREA] >= min_area
    return (keep[labels] * 255).astype(np.uint8), line_is_dark


_NEIGHBOURS = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]


def _trace(skel: NDArray[np.bool_]) -> tuple[list[list[tuple[int, int]]], list[tuple[int, int]]]:
    """Splits a skeleton into pixel paths between endpoints/junctions (and closed loops)."""
    pts = set(zip(*np.nonzero(skel), strict=True))

    def nbrs(p: tuple[int, int]) -> list[tuple[int, int]]:
        r, c = p
        return [(r + dr, c + dc) for dr, dc in _NEIGHBOURS if (r + dr, c + dc) in pts]

    degree = {p: len(nbrs(p)) for p in pts}
    nodes = {p for p, d in degree.items() if d != 2}
    junctions = [p for p, d in degree.items() if d >= 3]
    visited_edges: set[frozenset[tuple[int, int]]] = set()
    paths: list[list[tuple[int, int]]] = []

    def walk(start: tuple[int, int], nxt: tuple[int, int]) -> list[tuple[int, int]]:
        path = [start, nxt]
        visited_edges.add(frozenset((start, nxt)))
        prev, cur = start, nxt
        while cur not in nodes:
            cand = [q for q in nbrs(cur) if q != prev and frozenset((cur, q)) not in visited_edges]
            if not cand:
                break
            q = cand[0]
            visited_edges.add(frozenset((cur, q)))
            path.append(q)
            prev, cur = cur, q
            if cur == start:
                break
        return path

    for n in nodes:
        for q in nbrs(n):
            if frozenset((n, q)) not in visited_edges:
                paths.append(walk(n, q))
    # Pure loops (no endpoints or junctions): start anywhere.
    remaining = {p for p in pts if any(frozenset((p, q)) not in visited_edges for q in nbrs(p))}
    while remaining:
        p = next(iter(remaining))
        q = next(q for q in nbrs(p) if frozenset((p, q)) not in visited_edges)
        loop = walk(p, q)
        paths.append(loop)
        remaining -= set(loop)
        remaining = {
            x for x in remaining if any(frozenset((x, y)) not in visited_edges for y in nbrs(x))
        }
    return paths, junctions


def image_to_track(
    data: bytes,
    calibration: Calibration,
    *,
    track_id: str = "track.imported",
    name: str = "Imported track",
) -> tuple[dict[str, Any], Diagnostics]:
    calibration.validate()
    img = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise TrackImageError("This file is not an image OpenCV can read (use PNG or JPEG).")
    rect, mmpp = _rectify(img, calibration)
    gray = cv2.cvtColor(rect, cv2.COLOR_BGR2GRAY)
    mask, line_is_dark = _line_mask(gray, mmpp)
    if mask.max() == 0:
        raise TrackImageError(
            "No line found. Check the photo is in focus and the line contrasts with the floor."
        )

    dist = cv2.distanceTransform(mask, cv2.DIST_L2, 5)
    # scikit-image ships without type hints for skeletonize.
    skel: NDArray[np.bool_] = skeletonize(mask > 0)  # type: ignore[no-untyped-call]
    width_px = float(np.median(dist[skel]) * 2) if skel.any() else 0.0
    line_width_mm = round(width_px * mmpp, 1)

    paths, junction_px = _trace(skel)
    # Prune spurs shorter than the line width (skeleton artefacts at corners and ends).
    min_len_px = max(3.0, width_px * 1.2)
    paths = [p for p in paths if len(p) >= min_len_px or (len(p) > 2 and p[0] == p[-1])]
    if not paths:
        raise TrackImageError("The line was found but is too short to follow.")
    paths.sort(key=len, reverse=True)

    h = rect.shape[0]

    def to_mm(rc: tuple[int, int]) -> tuple[float, float]:
        r, c = rc
        return (round(c * mmpp, 2), round((h - 1 - r) * mmpp, 2))

    segments: list[dict[str, Any]] = []
    total = 0.0

    def simplify(p: list[tuple[int, int]]) -> list[tuple[float, float]]:
        arr = np.array([[c, r] for r, c in p], dtype=np.float32).reshape(-1, 1, 2)
        eps = max(0.5, 0.6 / mmpp)
        simple = cv2.approxPolyDP(arr, eps, closed=False).reshape(-1, 2)
        return [to_mm((px(y), px(x))) for x, y in simple]

    for p in paths:
        # Douglas-Peucker degenerates when a path starts and ends on the same pixel (a loop):
        # simplify each half separately.
        if len(p) > 4 and abs(p[0][0] - p[-1][0]) <= 1 and abs(p[0][1] - p[-1][1]) <= 1:
            mid = len(p) // 2
            pts_mm = simplify(p[: mid + 1]) + simplify(p[mid:])[1:]
        else:
            pts_mm = simplify(p)
        for a, b in pairwise(pts_mm):
            if a == b:
                continue
            segments.append(
                {"type": "line", "from": {"x": a[0], "y": a[1]}, "to": {"x": b[0], "y": b[1]}}
            )
            total += math.hypot(b[0] - a[0], b[1] - a[1])

    first = segments[0]
    heading = math.atan2(
        first["to"]["y"] - first["from"]["y"], first["to"]["x"] - first["from"]["x"]
    )
    junctions = (
        [
            {"type": "junction", "position": {"x": x, "y": y}, "branches": 3}
            for x, y in (to_mm(j) for j in junction_px[:: max(1, len(junction_px) // 50 or 1)])
        ]
        if len(paths) > 1
        else []
    )

    # Confidence: how much of the detected line the reconstruction covers (IoU-style).
    redraw = np.zeros_like(mask)
    thickness = max(1, round(width_px))
    for s in segments:
        a = (px(s["from"]["x"] / mmpp), px(h - 1 - s["from"]["y"] / mmpp))
        b = (px(s["to"]["x"] / mmpp), px(h - 1 - s["to"]["y"] / mmpp))
        cv2.line(redraw, a, b, 255, thickness)
    inter = np.logical_and(redraw > 0, mask > 0).sum()
    union = np.logical_or(redraw > 0, mask > 0).sum()
    confidence = round(float(inter / union) if union else 0.0, 3)

    line_val = float(gray[mask > 0].mean()) / 255
    bg_val = float(gray[mask == 0].mean()) / 255
    lo, hi = sorted((line_val, bg_val))
    line_refl, bg_refl = (lo, hi) if line_is_dark else (hi, lo)
    if abs(line_refl - bg_refl) < 0.05:
        line_refl, bg_refl = (0.05, 0.85) if line_is_dark else (0.85, 0.05)

    warnings: list[str] = []
    if confidence < 0.6:
        warnings.append("Low confidence: check the outline in the editor and fix any stray pieces.")
    if len(paths) > 1 and not junctions:
        warnings.append("Several separate pieces were found; they are kept as separate segments.")
    if line_width_mm < 5 or line_width_mm > 60:
        warnings.append(f"Unusual line width ({line_width_mm} mm): check the scale.")

    track = {
        "id": track_id,
        "name": name,
        "description": "Imported from an image. Check the scale and outline before simulating.",
        "units": "mm",
        "surface": {
            "lineColor": "#111111" if line_is_dark else "#f5f5f0",
            "backgroundColor": "#f5f5f0" if line_is_dark else "#111111",
            "lineReflectance": round(min(1.0, max(0.0, line_refl)), 3),
            "backgroundReflectance": round(min(1.0, max(0.0, bg_refl)), 3),
        },
        "lineWidthMm": max(1.0, line_width_mm),
        "segments": segments,
        "features": junctions,
        "start": {"x": first["from"]["x"], "y": first["from"]["y"], "headingRad": heading},
    }
    diag = Diagnostics(
        mm_per_px=mmpp,
        line_width_mm=line_width_mm,
        paths=len(paths),
        junctions=len(junctions),
        length_mm=round(total, 1),
        confidence=confidence,
        warnings=warnings,
    )
    return track, diag

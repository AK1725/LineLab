"""Robot silhouette from a top-view photo (BLUEPRINT §5.10 step 5).

The guided capture asks for the robot on a plain floor or table, shot from above. The background
colour is estimated from the image border; pixels far from it (in Lab colour) are the robot.
Significant regions near the largest one are merged (wheels, boards and plate can show up
separately) and the result is simplified to a polygon in fractions of the image size. Wheels are
part of the silhouette; LineLab clips the chassis plate inside them afterwards.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

import cv2
import numpy as np
from numpy.typing import NDArray

MAX_SIDE = 1024


class OutlineError(ValueError):
    """The robot could not be separated from the background."""


@dataclass
class Outline:
    polygon: list[tuple[float, float]]
    """Vertices as (x, y) fractions of width and height, origin top-left."""
    area_fraction: float
    contrast: float
    """Mean colour distance robot vs background (Lab units); low means unreliable."""
    width_px: int
    height_px: int


def _decode(data: bytes) -> NDArray[np.uint8]:
    img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise OutlineError("The file is not a PNG or JPEG image.")
    return img.astype(np.uint8)


def robot_outline(data: bytes) -> Outline:
    img = _decode(data)
    h0, w0 = img.shape[:2]
    k = min(1.0, MAX_SIDE / max(h0, w0))
    small = (
        cv2.resize(img, (round(w0 * k), round(h0 * k)), interpolation=cv2.INTER_AREA)
        if k < 1
        else img
    )
    h, w = small.shape[:2]
    lab = cv2.cvtColor(cv2.GaussianBlur(small, (5, 5), 0), cv2.COLOR_BGR2LAB).astype(np.float32)
    b = max(2, round(min(h, w) * 0.03))
    border = np.concatenate(
        [
            lab[:b].reshape(-1, 3),
            lab[-b:].reshape(-1, 3),
            lab[:, :b].reshape(-1, 3),
            lab[:, -b:].reshape(-1, 3),
        ]
    )
    bg = np.median(border, axis=0)
    # Lighting gradients change L most: weight it down against colour.
    diff = lab - bg
    dist = np.sqrt(0.5 * diff[..., 0] ** 2 + diff[..., 1] ** 2 + diff[..., 2] ** 2)
    dist8 = np.clip(dist * 2, 0, 255).astype(np.uint8)
    _, mask = cv2.threshold(dist8, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    r = max(3, round(min(h, w) * 0.01))
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=2)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    def touches_border(c: Any) -> bool:
        x, y, cw, ch = cv2.boundingRect(c)
        return bool(x <= 1 or y <= 1 or x + cw >= w - 1 or y + ch >= h - 1)

    def close_to(c: Any, rect: Sequence[int], reach: float) -> bool:
        x, y, cw, ch = cv2.boundingRect(c)
        mx, my, mw, mh = rect
        return bool(
            x < mx + mw + reach
            and x + cw > mx - reach
            and y < my + mh + reach
            and y + ch > my - reach
        )

    blobs = [c for c in contours if cv2.contourArea(c) >= 0.004 * w * h and not touches_border(c)]
    if not blobs:
        raise OutlineError("No robot found. Use a plain background that contrasts with the robot.")
    # A robot on a pale plate can show up as several blobs (boards, wheels, battery): keep those
    # near the largest and bridge the gaps between them.
    main = max(blobs, key=cv2.contourArea)
    rect = cv2.boundingRect(main)
    near = [c for c in blobs if close_to(c, rect, 0.12 * max(rect[2], rect[3]))]
    union = np.zeros_like(mask)
    cv2.drawContours(union, near, -1, 255, cv2.FILLED)
    bridge = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (6 * r + 1, 6 * r + 1))
    union = cv2.morphologyEx(union, cv2.MORPH_CLOSE, bridge)
    merged, _ = cv2.findContours(union, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    c = max(merged, key=cv2.contourArea)
    area = cv2.contourArea(c) / (w * h)
    if area < 0.02:
        raise OutlineError("The robot is too small in the photo. Fill most of the frame with it.")
    if area > 0.92:
        raise OutlineError(
            "Couldn't tell the robot from the background. Use a plain, contrasting background."
        )
    filled = np.zeros_like(mask)
    cv2.drawContours(filled, [c], -1, 255, cv2.FILLED)
    inside = float(dist[filled > 0].mean())
    outside = float(dist[filled == 0].mean())
    approx = cv2.approxPolyDP(c, 0.004 * cv2.arcLength(c, True), True).reshape(-1, 2)
    return Outline(
        polygon=[(float(x) / w, float(y) / h) for x, y in approx],
        area_fraction=float(area),
        contrast=inside - outside,
        width_px=w0,
        height_px=h0,
    )

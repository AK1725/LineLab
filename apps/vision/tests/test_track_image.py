import json

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.track_image import Calibration, TrackImageError, image_to_track
from tests.trackgen import centreline, load, mean_distance, photo

# Ten built-in tracks, each turned into a synthetic perspective photo with uneven lighting.
CASES = [
    "track.oval",
    "track.circle",
    "track.figure-eight",
    "track.s-curves",
    "track.right-angles",
    "track.acute-angles",
    "track.hairpins",
    "track.chicane",
    "track.zigzag",
    "track.wide-gentle",
]


@pytest.mark.parametrize("track_id", CASES)
def test_reconstructs_within_5mm(track_id: str) -> None:
    track = load(track_id)
    jpg, corners, w_mm, h_mm, truth = photo(track, seed=hash(track_id) % 1000)
    cal = Calibration(corners=tuple(corners), width_mm=w_mm, height_mm=h_mm)  # type: ignore[arg-type]
    result, diag = image_to_track(jpg, cal, track_id=track_id + "-imported")
    got = centreline(result)
    # Both directions: every reconstructed point is near the true line, and the whole true
    # line is covered by the reconstruction.
    assert mean_distance(got, truth) < 5.0, diag
    assert mean_distance(truth, got) < 5.0, diag
    assert abs(diag.line_width_mm - track["lineWidthMm"]) < 4.0
    assert diag.confidence > 0.5


def test_scan_with_known_scale_and_inverted_colours() -> None:
    track = load("track.oval")
    c = centreline(track)
    import cv2

    x0, y0 = c.min(axis=0) - 50
    h = int(c[:, 1].max() - y0 + 50)
    w = int(c[:, 0].max() - x0 + 50)
    img = np.full((h, w), 20, np.uint8)  # white line on black
    pix = np.stack([c[:, 0] - x0, h - (c[:, 1] - y0)], axis=1).astype(np.int32)
    cv2.polylines(img, [pix.reshape(-1, 1, 2)], False, 240, 19)
    ok, png = cv2.imencode(".png", img)
    assert ok
    result, diag = image_to_track(png.tobytes(), Calibration(mm_per_px=1.0))
    assert result["surface"]["lineReflectance"] > result["surface"]["backgroundReflectance"]
    truth = np.stack([c[:, 0] - x0, c[:, 1] - y0], axis=1)
    assert mean_distance(centreline(result), truth) < 3.0
    assert diag.paths >= 1


def test_errors_are_explained() -> None:
    with pytest.raises(TrackImageError, match="not an image"):
        image_to_track(b"definitely not a png", Calibration(mm_per_px=1.0))
    with pytest.raises(TrackImageError, match="scale"):
        image_to_track(b"x", Calibration())
    import cv2

    blank = cv2.imencode(".png", np.full((200, 200), 200, np.uint8))[1].tobytes()
    with pytest.raises(TrackImageError):
        image_to_track(blank, Calibration(mm_per_px=1.0))


client = TestClient(app)


def test_endpoint_round_trip() -> None:
    track = load("track.chicane")
    jpg, corners, w_mm, h_mm, _ = photo(track, seed=3)
    res = client.post(
        "/track/from-image",
        files={"file": ("track.jpg", jpg, "image/jpeg")},
        data={
            "corners": json.dumps(corners),
            "width_mm": str(w_mm),
            "height_mm": str(h_mm),
            "name": "My chicane",
        },
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["track"]["name"] == "My chicane"
    assert body["track"]["units"] == "mm"
    assert body["diagnostics"]["confidence"] > 0.5


def test_endpoint_rejects_bad_input() -> None:
    res = client.post(
        "/track/from-image",
        files={"file": ("x.png", b"nope", "image/png")},
        data={"mm_per_px": "1"},
    )
    assert res.status_code == 422
    res = client.post(
        "/track/from-image",
        files={"file": ("x.png", b"nope", "image/png")},
        data={"corners": "[[1,2]]"},
    )
    assert res.status_code == 422

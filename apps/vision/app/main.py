"""FastAPI entry point for the LineLab vision service.

- GET  /health
- POST /track/from-image: photo or scan of a track -> Track JSON (Phase 4)
Robot photo detection arrives in Phase 10 (see docs/BUILD_PLAN.md).
"""

import json
from dataclasses import asdict
from typing import Annotated, Any, Literal

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

from app.track_image import Calibration, TrackImageError, image_to_track

SERVICE_NAME = "linelab-vision"
VERSION = "0.1.0"
MAX_UPLOAD_BYTES = 25 * 1024 * 1024

app = FastAPI(title="LineLab Vision", version=VERSION)


class Health(BaseModel):
    status: Literal["ok"]
    service: str
    version: str


@app.get("/health")
def health() -> Health:
    return Health(status="ok", service=SERVICE_NAME, version=VERSION)


@app.post("/track/from-image")
async def track_from_image(
    file: Annotated[UploadFile, File(description="PNG or JPEG photo/scan of the track")],
    mm_per_px: Annotated[float | None, Form()] = None,
    corners: Annotated[str | None, Form(description="JSON [[x,y] x 4]: TL, TR, BR, BL")] = None,
    width_mm: Annotated[float | None, Form()] = None,
    height_mm: Annotated[float | None, Form()] = None,
    track_id: Annotated[str, Form()] = "track.imported",
    name: Annotated[str, Form()] = "Imported track",
) -> dict[str, Any]:
    data = await file.read()
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "Image is larger than 25 MB.")
    parsed_corners = None
    if corners:
        try:
            raw = json.loads(corners)
            parsed_corners = tuple((float(p[0]), float(p[1])) for p in raw)
            if len(parsed_corners) != 4:
                raise ValueError
        except (ValueError, TypeError, IndexError, json.JSONDecodeError) as err:
            raise HTTPException(422, "corners must be four [x, y] pixel pairs.") from err
    cal = Calibration(
        mm_per_px=mm_per_px,
        corners=parsed_corners,  # type: ignore[arg-type]
        width_mm=width_mm,
        height_mm=height_mm,
    )
    try:
        track, diag = image_to_track(data, cal, track_id=track_id, name=name)
    except TrackImageError as err:
        raise HTTPException(422, str(err)) from err
    return {"track": track, "diagnostics": asdict(diag)}

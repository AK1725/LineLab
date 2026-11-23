"""FastAPI entry point.

Phase 0 ships only the health endpoint. Track-image vectorisation arrives in Phase 4 and
robot-photo detection in Phase 10 (see docs/BUILD_PLAN.md).
"""

from typing import Literal

from fastapi import FastAPI
from pydantic import BaseModel

SERVICE_NAME = "linelab-vision"
VERSION = "0.0.0"

app = FastAPI(title="LineLab Vision", version=VERSION)


class Health(BaseModel):
    status: Literal["ok"]
    service: str
    version: str


@app.get("/health")
def health() -> Health:
    return Health(status="ok", service=SERVICE_NAME, version=VERSION)

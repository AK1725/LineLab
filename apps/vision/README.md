# @linelab/vision

Python 3.12+ FastAPI service, managed with [uv](https://docs.astral.sh/uv/).

```bash
cd apps/vision
uv sync
uv run uvicorn app.main:app --reload --port 8000   # http://localhost:8000/health
uv run pytest
```

From the repo root, `pnpm verify` runs this service's `ruff`, `mypy` and `pytest` too.

Status: health endpoint only. Track image vectorisation lands in **Phase 4**, robot photo detection in **Phase 10**.

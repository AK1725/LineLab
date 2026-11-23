from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health_reports_ok() -> None:
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json() == {"status": "ok", "service": "linelab-vision", "version": "0.0.0"}


def test_unknown_route_is_404() -> None:
    assert client.get("/nope").status_code == 404

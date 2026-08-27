import pytest
from starlette.responses import JSONResponse
from starlette.testclient import TestClient

from src.security.body_limit import BodySizeLimitMiddleware


async def _ok_app(scope, receive, send):
    await JSONResponse({"ok": True})(scope, receive, send)


@pytest.mark.no_db
def test_content_length_over_limit_is_413():
    app = BodySizeLimitMiddleware(_ok_app, max_bytes=64)
    client = TestClient(app)
    response = client.post("/", content=b"x" * 65)
    assert response.status_code == 413
    assert response.json()["detail"] == "Request body too large"


@pytest.mark.no_db
def test_content_length_within_limit_passes():
    app = BodySizeLimitMiddleware(_ok_app, max_bytes=64)
    client = TestClient(app)
    response = client.post("/", content=b"x" * 8)
    assert response.status_code == 200
    assert response.json() == {"ok": True}

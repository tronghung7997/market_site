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
    body = response.json()
    assert body["error_code"] == "REQUEST_TOO_LARGE"
    assert body["params"]["max_bytes"] == 64
    assert "Split it into smaller batches" in body["detail"]


@pytest.mark.no_db
def test_streamed_body_over_limit_is_coded_413():
    async def _reading_app(scope, receive, send):
        while (await receive()).get("more_body"):
            pass
        await JSONResponse({"ok": True})(scope, receive, send)

    app = BodySizeLimitMiddleware(_reading_app, max_bytes=64)
    client = TestClient(app)
    chunks = iter([b"x" * 40, b"x" * 40])
    response = client.post("/", content=chunks)
    assert response.status_code == 413
    assert response.json()["error_code"] == "REQUEST_TOO_LARGE"


@pytest.mark.no_db
def test_override_applies_only_to_matching_method_and_path():
    app = BodySizeLimitMiddleware(
        _ok_app, max_bytes=64, overrides=[("POST", r"/bulk/\d+", 256)],
    )
    client = TestClient(app)
    assert client.post("/bulk/7", content=b"x" * 200).status_code == 200
    over = client.post("/bulk/7", content=b"x" * 300)
    assert over.status_code == 413
    assert over.json()["params"]["max_bytes"] == 256
    assert client.put("/bulk/7", content=b"x" * 200).status_code == 413
    assert client.post("/bulk/7/extra", content=b"x" * 200).status_code == 413
    assert client.post("/other", content=b"x" * 200).status_code == 413


@pytest.mark.no_db
def test_default_limits_keep_restock_wider_than_global():
    from src.config import Settings

    assert Settings.model_fields["max_request_body_bytes"].default == 1024 * 1024
    assert Settings.model_fields["restock_max_request_body_bytes"].default == 20 * 1024 * 1024


@pytest.mark.no_db
def test_content_length_within_limit_passes():
    app = BodySizeLimitMiddleware(_ok_app, max_bytes=64)
    client = TestClient(app)
    response = client.post("/", content=b"x" * 8)
    assert response.status_code == 200
    assert response.json() == {"ok": True}

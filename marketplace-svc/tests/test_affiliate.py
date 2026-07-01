import pytest
from sqlalchemy import select

from src.database import SessionLocal
from src.models.account import Account
from src.models.affiliate import AffiliateClick


@pytest.mark.asyncio
async def test_click_valid_code_creates_row(client):
    reg = await client.post("/auth/register", json={
        "email": "aff_click@example.com",
        "password": "StrongPass123!",
    })
    affiliate_id = reg.json()["id"]
    async with SessionLocal() as db:
        affiliate = await db.scalar(select(Account).where(Account.id == affiliate_id))
        code = affiliate.affiliate_code

    resp = await client.post("/affiliate/click", json={"code": code, "path": "/p/1", "referrer": "https://t.co"})
    assert resp.status_code == 204

    async with SessionLocal() as db:
        click = await db.scalar(select(AffiliateClick).where(AffiliateClick.affiliate_account_id == affiliate_id))
    assert click is not None
    assert click.path == "/p/1"
    assert click.referrer == "https://t.co"


@pytest.mark.asyncio
async def test_click_unknown_code_no_row_no_error(client):
    resp = await client.post("/affiliate/click", json={"code": "NOPE0000"})
    assert resp.status_code == 204

    async with SessionLocal() as db:
        result = await db.execute(select(AffiliateClick))
        assert result.scalars().first() is None


@pytest.mark.asyncio
async def test_click_requires_no_auth(client):
    resp = await client.post("/affiliate/click", json={"code": "ANYCODE1"})
    assert resp.status_code == 204

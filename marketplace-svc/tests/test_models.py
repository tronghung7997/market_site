import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from src.config import settings


@pytest.mark.asyncio
async def test_database_connection():
    engine = create_async_engine(settings.database_url)
    async with engine.connect() as conn:
        result = await conn.execute(text("SELECT 1"))
        assert result.scalar() == 1
    await engine.dispose()


@pytest.mark.asyncio
async def test_all_models_importable():
    from src.models import (
        Account, Alert, Category, Dispute, LogEntry,
        Order, Product, ProductVariant, Provider, ProviderHealth,
        Resource, SellerApplication, Transaction, Wallet, WithdrawRequest,
        MailOutbox, PasswordResetToken,
    )
    assert Account.__tablename__ == "accounts"
    assert Wallet.__tablename__ == "wallets"
    assert Category.__tablename__ == "categories"
    assert Product.__tablename__ == "products"
    assert ProductVariant.__tablename__ == "product_variants"
    assert Resource.__tablename__ == "resources"
    assert Order.__tablename__ == "orders"
    assert Dispute.__tablename__ == "disputes"
    assert Provider.__tablename__ == "providers"
    assert ProviderHealth.__tablename__ == "provider_health"
    assert Alert.__tablename__ == "alerts"
    assert LogEntry.__tablename__ == "log_entries"
    assert SellerApplication.__tablename__ == "seller_applications"
    assert Transaction.__tablename__ == "transactions"
    assert WithdrawRequest.__tablename__ == "withdraw_requests"
    assert MailOutbox.__tablename__ == "mail_outbox"
    assert PasswordResetToken.__tablename__ == "password_reset_tokens"

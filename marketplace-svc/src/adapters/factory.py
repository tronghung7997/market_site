from sqlalchemy.ext.asyncio import AsyncSession

from src.adapters.base import ProviderAdapter
from src.adapters.manual import ManualAdapter
from src.adapters.mock import MockAdapter
from src.adapters.real_api import RealApiAdapter
from src.adapters.seller_pool import SellerPoolAdapter
from src.adapters.seller_task_webhook import SellerTaskWebhookAdapter
from src.models.provider import Provider

ADAPTER_MAP: dict[str, type[ProviderAdapter]] = {
    "mock": MockAdapter,
    "seller_pool": SellerPoolAdapter,
    "manual": ManualAdapter,
    "topproxy": RealApiAdapter,
    "scrapecreators": RealApiAdapter,
    # Cùng cơ chế gọi HTTP thật với topproxy/scrapecreators (retry, idempotency,
    # ProviderCallLog) — khác ở chỗ base_url trỏ vào backend do SELLER tự khai,
    # không phải nhà cung cấp admin curate. Xem RealApiAdapter.call() (per-request
    # forward, dùng bởi src/gateway/router.py) và spec 2026-07-21.
    "seller_gateway": RealApiAdapter,
    "seller_task_webhook": SellerTaskWebhookAdapter,
}

MAX_FALLBACK_DEPTH = 3


async def get_adapter(provider_id: int, db: AsyncSession) -> ProviderAdapter:
    """Load a provider from DB and return the matching adapter instance.

    If the provider is inactive and has a fallback, follow the chain (max 3 hops).
    """
    visited: set[int] = set()
    current_id = provider_id

    for _ in range(MAX_FALLBACK_DEPTH + 1):
        if current_id in visited:
            raise ValueError(f"Circular fallback detected at provider {current_id}")
        visited.add(current_id)

        provider = await db.get(Provider, current_id)
        if provider is None:
            raise ValueError(f"Provider {current_id} not found")

        if provider.is_active:
            return _instantiate(provider, db)

        # Inactive — try fallback
        if provider.fallback_provider_id is not None:
            current_id = provider.fallback_provider_id
        else:
            raise ValueError(
                f"Provider {provider.name} (id={provider.id}) is inactive with no fallback"
            )

    raise ValueError(f"Fallback chain exceeded max depth ({MAX_FALLBACK_DEPTH})")


def _instantiate(provider: Provider, db: AsyncSession) -> ProviderAdapter:
    adapter_cls = ADAPTER_MAP.get(provider.adapter_type)
    if adapter_cls is None:
        raise ValueError(f"Unknown adapter_type: {provider.adapter_type!r}")

    config = provider.config or {}

    if adapter_cls in (SellerPoolAdapter, ManualAdapter):
        return adapter_cls(config, db=db)

    if adapter_cls is SellerTaskWebhookAdapter:
        return adapter_cls(
            config, db=db, provider_id=provider.id, seller_owned=provider.seller_id is not None,
        )

    if adapter_cls is RealApiAdapter:
        return adapter_cls(config, provider_id=provider.id, seller_owned=provider.seller_id is not None)

    return adapter_cls(config)

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.adapters.dproxy import validate_dproxy_config
from src.exceptions import NotOwner
from src.models.provider import Provider, ProviderHealth
from src.providers.schemas import SELLER_ALLOWED_ADAPTER_TYPES
from src.security.crypto import encrypt_config
from src.security.ssrf_guard import validate_seller_base_url

# seller_task_webhook's callback (POST /webhooks/providers/{id}/tasks/{external_task_id},
# src/gateway/router.py) is only as trustworthy as this secret — no secret means
# anyone who can guess a provider_id + external_task_id can complete/fail a
# buyer's task and trigger delivery/refund. Enforced at the one place both
# create and update funnel through, so there is no path to a provider row of
# this adapter_type without one.
_REQUIRES_WEBHOOK_SECRET = {"seller_task_webhook"}


def _check_webhook_secret(adapter_type: str | None, config: dict | None) -> None:
    if adapter_type in _REQUIRES_WEBHOOK_SECRET and not (config or {}).get("webhook_secret"):
        raise HTTPException(
            status_code=400,
            detail=f"adapter_type '{adapter_type}' bắt buộc phải có config.webhook_secret",
        )


async def create_provider(data: dict, db: AsyncSession) -> Provider:
    if not data.get("type"):
        data["type"] = data.get("adapter_type", "mock")
    _check_webhook_secret(data.get("adapter_type"), data.get("config"))
    if data.get("adapter_type") == "dproxy":
        await validate_dproxy_config(data.get("config") or {})
    if "config" in data and data["config"]:
        data["config"] = encrypt_config(data["config"])
    provider = Provider(**data)
    db.add(provider)
    await db.commit()
    await db.refresh(provider)
    return provider


async def update_provider(provider_id: int, updates: dict, db: AsyncSession) -> Provider:
    provider = await db.get(Provider, provider_id)
    if not provider:
        raise HTTPException(status_code=404, detail="Không tìm thấy nhà cung cấp")

    # Xét theo trạng thái SAU khi áp updates — đổi adapter_type sang
    # seller_task_webhook mà không kèm secret, hoặc xoá secret khỏi config
    # trong khi vẫn giữ adapter_type này, đều phải bị chặn như nhau.
    next_adapter_type = updates.get("adapter_type", provider.adapter_type)
    next_config = updates["config"] if "config" in updates else provider.config
    _check_webhook_secret(next_adapter_type, next_config)
    if next_adapter_type == "dproxy" and "config" in updates:
        await validate_dproxy_config(updates["config"] or {})

    if "config" in updates and updates["config"]:
        updates["config"] = encrypt_config(updates["config"])

    for key, value in updates.items():
        setattr(provider, key, value)

    await db.commit()
    await db.refresh(provider)
    return provider


async def create_seller_provider(seller_id: int, data: dict, db: AsyncSession) -> Provider:
    """Seller tự đăng ký backend của họ — luôn `pending_review`, không bao giờ
    tự động approved (khác `create_provider` admin-path). Admin duyệt bằng
    đúng nút Test đã có ở /admin/providers rồi mới `review_provider()`, không
    cần đọc hiểu nghiệp vụ seller — chỉ cần connector trả lời đúng contract
    (adapters/base.py::ProviderAdapter), xem spec 2026-07-21 nguyên tắc chung."""
    adapter_type = data.get("adapter_type")
    if adapter_type not in SELLER_ALLOWED_ADAPTER_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Seller chỉ tự đăng ký được adapter_type: {', '.join(sorted(SELLER_ALLOWED_ADAPTER_TYPES))}",
        )
    config = data.get("config") or {}
    _check_webhook_secret(adapter_type, config)
    await validate_seller_base_url(config.get("base_url", ""))
    provider = Provider(
        name=data["name"], type=adapter_type, adapter_type=adapter_type,
        config=encrypt_config(config), priority=1, is_active=True,
        seller_id=seller_id, review_status="pending_review",
    )
    db.add(provider)
    await db.commit()
    await db.refresh(provider)
    return provider


async def list_seller_providers(seller_id: int, db: AsyncSession) -> list[Provider]:
    result = await db.execute(
        select(Provider).where(Provider.seller_id == seller_id).order_by(Provider.id.desc())
    )
    return list(result.scalars().all())


async def get_seller_provider(seller_id: int, provider_id: int, db: AsyncSession) -> Provider:
    provider = await db.get(Provider, provider_id)
    if not provider or provider.seller_id != seller_id:
        raise NotOwner()
    return provider


async def update_seller_provider(seller_id: int, provider_id: int, updates: dict, db: AsyncSession) -> Provider:
    provider = await get_seller_provider(seller_id, provider_id, db)

    next_config = updates["config"] if "config" in updates else provider.config
    _check_webhook_secret(provider.adapter_type, next_config)
    if "config" in updates:
        await validate_seller_base_url((updates["config"] or {}).get("base_url", ""))

    if "config" in updates and updates["config"]:
        updates["config"] = encrypt_config(updates["config"])

    for key, value in updates.items():
        setattr(provider, key, value)

    # Sửa cấu hình (credential/base_url) sau khi đã duyệt thì buộc duyệt lại —
    # admin mới xác nhận CONNECTOR CŨ hoạt động đúng, sửa xong không có gì đảm
    # bảo connector MỚI vẫn đúng chỉ vì cùng provider_id.
    if "config" in updates and provider.review_status == "approved":
        provider.review_status = "pending_review"
        provider.review_note = None

    await db.commit()
    await db.refresh(provider)
    return provider


async def review_provider(provider_id: int, decision: str, note: str | None, db: AsyncSession) -> Provider:
    """Admin duyệt/từ chối một provider seller tự đăng ký. Chỉ áp dụng cho
    provider có seller_id — provider admin tự tạo không cần (và không có)
    hàng chờ duyệt, mặc định approved ngay từ lúc tạo."""
    provider = await db.get(Provider, provider_id)
    if not provider:
        raise HTTPException(status_code=404, detail="Không tìm thấy nhà cung cấp")
    if provider.seller_id is None:
        raise HTTPException(
            status_code=400, detail="Provider này do admin tạo, không cần quy trình duyệt",
        )
    if decision not in ("approved", "rejected", "disabled"):
        raise HTTPException(status_code=400, detail="decision phải là approved/rejected/disabled")
    provider.review_status = decision
    provider.review_note = note
    await db.commit()
    await db.refresh(provider)
    return provider


async def list_providers(db: AsyncSession) -> list[Provider]:
    result = await db.execute(select(Provider).order_by(Provider.priority.desc()))
    return list(result.scalars().all())


async def get_health_history(provider_id: int, db: AsyncSession) -> list[ProviderHealth]:
    result = await db.execute(
        select(ProviderHealth).where(ProviderHealth.provider_id == provider_id)
        .order_by(ProviderHealth.checked_at.desc()).limit(100)
    )
    return list(result.scalars().all())


async def compute_quality_score(provider, db) -> float | None:
    from src.models.provider import ProviderHealth
    rows = (await db.execute(
        select(ProviderHealth).where(ProviderHealth.provider_id == provider.id)
        .order_by(ProviderHealth.checked_at.desc()).limit(20)
    )).scalars().all()
    if not rows:
        return None
    uptime = sum(1 for h in rows if h.status == "healthy") / len(rows)
    success = sum(h.success_rate for h in rows) / len(rows)
    latencies = [h.latency_ms for h in rows if h.latency_ms is not None]
    avg_latency = (sum(latencies) / len(latencies)) if latencies else 0
    latency_factor = max(0.0, min(1.0, 1 - avg_latency / 2000))
    return round(100 * (0.5 * uptime + 0.3 * success + 0.2 * latency_factor), 1)


async def apply_scores(db) -> int:
    from src.models.provider import Provider
    providers = (await db.execute(select(Provider).where(Provider.is_active))).scalars().all()
    updated = 0
    for p in providers:
        score = await compute_quality_score(p, db)
        if score is None:
            continue
        p.quality_score = score
        p.priority = max(1, round(score / 10))
        updated += 1
    return updated

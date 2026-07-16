from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.provider import Provider, ProviderHealth
from src.security.crypto import encrypt_config


async def create_provider(data: dict, db: AsyncSession) -> Provider:
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

    if "config" in updates and updates["config"]:
        updates["config"] = encrypt_config(updates["config"])

    for key, value in updates.items():
        setattr(provider, key, value)

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

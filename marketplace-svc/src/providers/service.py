from datetime import UTC, datetime

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.adapters.registry import get_spec
from src.exceptions import NotOwner
from src.models.provider import Provider, ProviderHealth
from src.providers.schemas import MASKED_SECRET, SELLER_ALLOWED_ADAPTER_TYPES
from src.security.crypto import SENSITIVE_CONFIG_KEYS
from src.security.crypto import encrypt_config
from src.security.ssrf_guard import validate_seller_base_url


async def _validate_adapter_config(adapter_type: str | None, config: dict | None) -> None:
    """Kiểm tra config HIỆU DỤNG theo khai báo của adapter (AdapterSpec,
    adapters/registry.py) — gọi ở mọi đường create/update, admin lẫn seller,
    nên không có lối nào ghi được một provider row vi phạm contract của
    adapter_type nó mang.

    - webhook secret: callback HMAC (POST /webhooks/providers/{id}/tasks/...,
      src/gateway/router.py) chỉ đáng tin bằng secret này — thiếu nó thì ai
      đoán được provider_id + external_task_id là giả mạo được kết quả task.
    - validate_config: hook riêng của adapter (vd dproxy/topproxy kiểm tra
      base_url, key, mode) — chạy trên config hiệu dụng kể cả khi request chỉ
      đổi adapter_type mà giữ config cũ (review fixes Medium B).

    adapter_type lạ thì bỏ qua — không khoá dữ liệu cũ; luồng bán đã chặn ở
    get_adapter.
    """
    spec = get_spec(adapter_type)
    if spec is None:
        return
    if spec.requires_webhook_secret and not (config or {}).get("webhook_secret"):
        raise HTTPException(
            status_code=400,
            detail=f"adapter_type '{adapter_type}' bắt buộc phải có config.webhook_secret",
        )
    if spec.validate_config is not None:
        await spec.validate_config(config or {})


def _merge_masked_secrets(config: dict, existing: dict | None = None) -> dict:
    """Treat the response mask as "keep current", never as a credential.

    Only the explicit MASKED_SECRET sentinel preserves the previous value.
    Omitting a sensitive key from a config update is a deliberate clear (so
    required secrets fail validation rather than silently surviving).
    """
    merged = dict(config)
    for key in SENSITIVE_CONFIG_KEYS:
        if key not in merged:
            # Key omitted → leave omitted (full/partial config replacement).
            continue
        submitted = merged.get(key)
        previous = (existing or {}).get(key)
        if existing is not None and previous and submitted == MASKED_SECRET:
            merged[key] = previous
            continue
        if submitted == MASKED_SECRET and not previous:
            raise HTTPException(status_code=400, detail=f"config.{key} phải được nhập lại")
        if submitted in (None, ""):
            # Explicit empty clear — drop the key so requires_* validation can fire.
            merged.pop(key, None)
    return merged


async def create_provider(
    data: dict, db: AsyncSession, *, actor_id: int | None = None,
) -> Provider:
    from src.audit.service import log_event
    from src.logging import current_request_id

    if not data.get("type"):
        data["type"] = data.get("adapter_type", "mock")
    if data.get("config"):
        data["config"] = _merge_masked_secrets(data["config"])
    await _validate_adapter_config(data.get("adapter_type"), data.get("config"))
    if "config" in data and data["config"]:
        data["config"] = encrypt_config(data["config"])
    provider = Provider(**data)
    db.add(provider)
    await db.flush()
    await log_event(
        db, "info", f"Provider {provider.id} created",
        request_id=current_request_id(),
        metadata={
            "event": "provider_created",
            "actor_id": actor_id,
            "actor_type": "admin",
            "subject_type": "provider",
            "subject_id": provider.id,
            "outcome": "success",
            "source": "admin",
            "provider_id": provider.id,
            "changed_fields": sorted(k for k in data.keys() if k != "config")
            + (["config"] if "config" in data else []),
        },
    )
    await db.commit()
    await db.refresh(provider)
    return provider


async def update_provider(
    provider_id: int, updates: dict, db: AsyncSession, *, actor_id: int | None = None,
) -> Provider:
    from src.audit.service import log_event
    from src.logging import current_request_id

    provider = await db.get(Provider, provider_id)
    if not provider:
        raise HTTPException(status_code=404, detail="Không tìm thấy nhà cung cấp")

    # Xét theo trạng thái SAU khi áp updates — đổi adapter_type mà không kèm
    # config hợp lệ cho loại mới, hoặc xoá field bắt buộc khỏi config trong
    # khi vẫn giữ adapter_type cũ, đều phải bị chặn như nhau.
    next_adapter_type = updates.get("adapter_type", provider.adapter_type)
    if "config" in updates:
        updates["config"] = _merge_masked_secrets(updates["config"] or {}, provider.config)
    next_config = updates["config"] if "config" in updates else provider.config
    await _validate_adapter_config(next_adapter_type, next_config)

    if "config" in updates and updates["config"]:
        updates["config"] = encrypt_config(updates["config"])

    changed = sorted(updates.keys())
    for key, value in updates.items():
        setattr(provider, key, value)

    await log_event(
        db, "info", f"Provider {provider_id} updated",
        request_id=current_request_id(),
        metadata={
            "event": "provider_updated",
            "actor_id": actor_id,
            "actor_type": "admin",
            "subject_type": "provider",
            "subject_id": provider_id,
            "outcome": "success" if changed else "no_change",
            "source": "admin",
            "provider_id": provider_id,
            # Field names only — never credential values.
            "changed_fields": changed,
        },
    )
    await db.commit()
    await db.refresh(provider)
    return provider


def _seller_config(raw: dict, existing: dict | None = None) -> dict:
    forbidden = {"skip_health_probe", "skip_provision_handshake"} & set(raw)
    if forbidden:
        raise HTTPException(status_code=400, detail="Seller không được bỏ qua contract test")
    return _merge_masked_secrets(raw, existing)


async def create_seller_provider(seller_id: int, data: dict, db: AsyncSession) -> Provider:
    """Save a seller integration as a draft. Testing and review submission are
    explicit later transitions; saving credentials never queues admin work."""
    adapter_type = data.get("adapter_type")
    if adapter_type not in SELLER_ALLOWED_ADAPTER_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Seller chỉ tự đăng ký được adapter_type: {', '.join(sorted(SELLER_ALLOWED_ADAPTER_TYPES))}",
        )
    config = _seller_config(data.get("config") or {})
    await _validate_adapter_config(adapter_type, config)
    await validate_seller_base_url(config.get("base_url", ""))
    provider = Provider(
        name=data["name"], type=adapter_type, adapter_type=adapter_type,
        config=encrypt_config(config), priority=1, is_active=True,
        seller_id=seller_id, review_status="draft",
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

    if "config" in updates:
        if provider.review_status == "approved":
            raise HTTPException(
                status_code=409,
                detail="Tích hợp đã duyệt đang được bảo vệ. Hãy tạo tích hợp mới để thay đổi kết nối.",
            )
        updates["config"] = _seller_config(updates["config"] or {}, provider.config)
    next_config = updates["config"] if "config" in updates else provider.config
    await _validate_adapter_config(provider.adapter_type, next_config)
    if "config" in updates:
        await validate_seller_base_url((updates["config"] or {}).get("base_url", ""))
        updates["config"] = encrypt_config(updates["config"])

    for key, value in updates.items():
        setattr(provider, key, value)

    if "config" in updates:
        provider.review_status = "draft"
        provider.review_note = None
        provider.last_tested_at = None
        provider.last_test_result = None

    await db.commit()
    await db.refresh(provider)
    return provider


async def record_seller_provider_test(
    seller_id: int,
    provider_id: int,
    result: dict,
    db: AsyncSession,
) -> Provider:
    provider = await get_seller_provider(seller_id, provider_id, db)
    health = result.get("health") or {}
    provision = result.get("provision_test")
    passed = (
        health.get("status") == "healthy"
        and health.get("probe") != "skipped"
        and isinstance(provision, dict)
        and provision.get("success") is True
    )
    provider.last_tested_at = datetime.now(UTC)
    provider.last_test_result = {
        "passed": passed,
        "health": {
            "status": health.get("status"),
            "message": health.get("message"),
        },
        "provision_test": {
            "success": provision.get("success"),
            "error": provision.get("error"),
        } if isinstance(provision, dict) else None,
        "provision_test_skipped_reason": result.get("provision_test_skipped_reason"),
    }
    if provider.review_status not in ("approved", "disabled"):
        provider.review_status = "tested" if passed else "test_failed"
    await db.commit()
    await db.refresh(provider)
    return provider


async def submit_seller_provider(seller_id: int, provider_id: int, db: AsyncSession) -> Provider:
    provider = await get_seller_provider(seller_id, provider_id, db)
    if provider.review_status != "tested":
        raise HTTPException(status_code=409, detail="Hãy test kết nối thành công trước khi gửi duyệt")
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
    if decision in ("approved", "rejected") and provider.review_status != "pending_review":
        raise HTTPException(status_code=409, detail="Seller chưa gửi tích hợp này để admin duyệt")
    if decision == "rejected" and not (note or "").strip():
        # A rejection that gives the seller no actionable reason just creates
        # another support loop.  The UI enforces this too; keep the rule at
        # the service seam so API clients cannot bypass it.
        raise HTTPException(status_code=400, detail="Từ chối provider phải kèm lý do để seller sửa cấu hình")
    provider.review_status = decision
    provider.review_note = note
    if decision in ("approved", "rejected") and provider.seller_id is not None:
        from src.mail.service import enqueue_mail, frontend_url
        template = "provider_approved" if decision == "approved" else "provider_rejected"
        await enqueue_mail(
            db,
            template=template,
            account_id=provider.seller_id,
            idempotency_key=f"provider_review:{provider.id}:{decision}",
            payload={
                "provider_name": provider.name,
                "reason": (note or "").strip(),
                "action_url": frontend_url("vi", "/seller/providers"),
            },
        )
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

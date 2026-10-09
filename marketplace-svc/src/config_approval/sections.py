"""The admin settings forms that need a second admin's approval.

One ``register(...)`` per section; see ``registry.py`` for the contract. Each
``apply`` is the section's existing update function, so validation, audit
(``*_changed`` with old → new) and cache invalidation stay where they were.
Snapshots read the config row directly (never a process cache) and leave out
fields that are applied immediately, so an emergency switch never makes a
pending request look stale.
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.affiliate.schemas import AffiliateRuntimeConfigUpdate
from src.affiliate.settings import ensure_seeded as affiliate_seed
from src.affiliate.settings import update_affiliate_settings
from src.buyer_tiers import config as buyer_tier_config
from src.auth.schemas import AuthRuntimeConfigUpdate
from src.auth.settings import ensure_seeded as auth_seed
from src.auth.settings import update_auth_settings
from src.fees.schemas import FeeRuntimeConfigUpdate
from src.fees.settings import change_labels as fee_change_labels
from src.fees.settings import ensure_seeded as fee_seed
from src.fees.settings import update_fee_settings
from src.models.affiliate_runtime_config import AffiliateRuntimeConfig
from src.models.buyer_tier import BuyerTierConfig
from src.models.auth_runtime_config import AuthRuntimeConfig
from src.models.deposit_rail_config import DepositRailConfig
from src.models.display_money_config import DisplayMoneyConfig
from src.models.fee_runtime_config import FeeRuntimeConfig
from src.models.seller_runtime_config import SellerRuntimeConfig
from src.models.seller_tier_config import SellerTierConfig
from src.models.seller_trust_config import SellerTrustConfig
from src.models.site_runtime_config import SiteRuntimeConfig
from src.money import service as money_service
from src.money.schemas import MoneyConfigUpdate
from src.payments import rail_config
from src.payments.schemas import DepositRailConfigUpdate
from src.seller.schemas import SellerRuntimeConfigUpdate
from src.seller.settings import ensure_seeded as seller_seed
from src.seller.settings import update_seller_settings
from src.sellers import trust
from src.sellers.tier_config import ensure_seeded as tier_seed
from src.sellers.tier_config import update_tier_rules
from src.site_status.schemas import SiteStatusUpdate
from src.site_status.service import ensure_seeded as site_seed
from src.site_status.service import update_site_status

from .registry import ConfigSection, flatten, fresh, parse_with, register, row_values

SETTINGS_HREF = "/admin/display-settings"


# ── fees & holds ────────────────────────────────────────────────────────────

async def _fee_apply(db: AsyncSession, actor_id: int, changes: dict, dry_run: bool):
    return await update_fee_settings(db, actor_id=actor_id, dry_run=dry_run, **changes)


async def _fee_snapshot(db: AsyncSession) -> dict:
    await fee_seed(db)
    return row_values(await fresh(db, FeeRuntimeConfig))


async def _fee_context(db: AsyncSession, diff: dict) -> dict:
    return await fee_change_labels(db, diff)


register(ConfigSection(
    key="fee_config", label="Phí & giữ tiền", audit_event="fee_runtime_config_changed",
    href=f"{SETTINGS_HREF}?tab=fees", apply=_fee_apply, snapshot=_fee_snapshot,
    parse=parse_with(FeeRuntimeConfigUpdate), context=_fee_context,
))


# ── system: maintenance + money freezes (emergency), announcement, upload cap ─

SITE_EMERGENCY_FIELDS = frozenset({
    "maintenance_enabled", "maintenance_message_vi", "maintenance_message_en", "maintenance_until",
    "clear_maintenance_until", "withdrawals_frozen", "deposits_frozen", "orders_frozen", "freeze_reason",
})


async def _site_apply(db: AsyncSession, actor_id: int, changes: dict, dry_run: bool):
    changes = dict(changes)
    return await update_site_status(
        db, actor_id=actor_id, dry_run=dry_run,
        clear_maintenance_until=bool(changes.pop("clear_maintenance_until", False)),
        clear_announcement_window=bool(changes.pop("clear_announcement_window", False)),
        **changes,
    )


async def _site_snapshot(db: AsyncSession) -> dict:
    await site_seed(db)
    # announcement_version is derived from the text fields.
    return row_values(await fresh(db, SiteRuntimeConfig), skip=SITE_EMERGENCY_FIELDS | {"announcement_version"})


async def _site_full_snapshot(db: AsyncSession) -> dict:
    await site_seed(db)
    return row_values(await fresh(db, SiteRuntimeConfig), skip={"announcement_version"})


register(ConfigSection(
    key="site_status", label="Hệ thống", audit_event="site_runtime_config_changed",
    href=f"{SETTINGS_HREF}?tab=system", apply=_site_apply, snapshot=_site_snapshot,
    parse=parse_with(SiteStatusUpdate), immediate_fields=SITE_EMERGENCY_FIELDS, emergency=True,
    immediate_snapshot=_site_full_snapshot,
))


# ── affiliate ───────────────────────────────────────────────────────────────

async def _affiliate_apply(db: AsyncSession, actor_id: int, changes: dict, dry_run: bool):
    return await update_affiliate_settings(db, actor_id=actor_id, dry_run=dry_run, **changes)


async def _affiliate_snapshot(db: AsyncSession) -> dict:
    await affiliate_seed(db)
    return row_values(await fresh(db, AffiliateRuntimeConfig))


register(ConfigSection(
    key="affiliate_config", label="Affiliate", audit_event="affiliate_runtime_config_changed",
    href=f"{SETTINGS_HREF}?tab=affiliate", apply=_affiliate_apply, snapshot=_affiliate_snapshot,
    parse=parse_with(AffiliateRuntimeConfigUpdate),
))


# ── accounts: sign-up verification, 2FA policy, captcha ─────────────────────

async def _auth_apply(db: AsyncSession, actor_id: int, changes: dict, dry_run: bool):
    return await update_auth_settings(db, actor_id=actor_id, dry_run=dry_run, **changes)


async def _auth_snapshot(db: AsyncSession) -> dict:
    await auth_seed(db)
    return row_values(await fresh(db, AuthRuntimeConfig))


register(ConfigSection(
    key="auth_config", label="Tài khoản & bảo mật", audit_event="auth_runtime_config_changed",
    href=f"{SETTINGS_HREF}?tab=accounts", apply=_auth_apply, snapshot=_auth_snapshot,
    parse=parse_with(AuthRuntimeConfigUpdate),
))


# ── seller workspace knobs ──────────────────────────────────────────────────

async def _seller_apply(db: AsyncSession, actor_id: int, changes: dict, dry_run: bool):
    return await update_seller_settings(db, actor_id=actor_id, dry_run=dry_run, **changes)


async def _seller_snapshot(db: AsyncSession) -> dict:
    await seller_seed(db)
    return row_values(await fresh(db, SellerRuntimeConfig))


register(ConfigSection(
    key="seller_config", label="Cài đặt người bán", audit_event="seller_runtime_config_changed",
    href=f"{SETTINGS_HREF}?tab=seller", apply=_seller_apply, snapshot=_seller_snapshot,
    parse=parse_with(SellerRuntimeConfigUpdate),
))


# ── display money: FX rate and currency switches ────────────────────────────

async def _money_apply(db: AsyncSession, actor_id: int, changes: dict, dry_run: bool):
    return await money_service.update_config(db, actor_id=actor_id, dry_run=dry_run, **changes)


async def _money_snapshot(db: AsyncSession) -> dict:
    await money_service.ensure_seeded(db)
    return row_values(await fresh(db, DisplayMoneyConfig))


register(ConfigSection(
    key="money_config", label="Tiền tệ & tỷ giá", audit_event="display_money_config_changed",
    href=f"{SETTINGS_HREF}?tab=display", apply=_money_apply, snapshot=_money_snapshot,
    parse=parse_with(MoneyConfigUpdate),
))


# ── deposit rails: limits, windows, SePay destination ───────────────────────

async def _rails_apply(db: AsyncSession, actor_id: int, changes: dict, dry_run: bool):
    return await rail_config.update_config(db, actor_id=actor_id, dry_run=dry_run, **changes)


async def _rails_snapshot(db: AsyncSession) -> dict:
    await rail_config.ensure_seeded(db)
    return row_values(await fresh(db, DepositRailConfig))


register(ConfigSection(
    key="deposit_rails", label="Kênh nạp tiền", audit_event="deposit_rail_config_changed",
    href=f"{SETTINGS_HREF}?tab=deposits", apply=_rails_apply, snapshot=_rails_snapshot,
    parse=parse_with(DepositRailConfigUpdate),
))


# ── seller tier levers (one row per tier) ───────────────────────────────────
# The badge icon is cosmetic and attaches the uploader's own pending image
# (media ownership), so it is applied at once; the levers wait for approval.

def _tier_split(payload: dict) -> tuple[dict, dict]:
    immediate: dict = {}
    gated: dict = {}
    for tier, patch in (payload.get("tiers") or {}).items():
        patch = dict(patch or {})
        if "badge_image_id" in patch:
            immediate[tier] = {"badge_image_id": patch.pop("badge_image_id")}
        if patch:
            gated[tier] = patch
    return ({"tiers": immediate} if immediate else {}), ({"tiers": gated} if gated else {})


def _tier_parse(payload: dict) -> dict:
    return {"tiers": {t: dict(p) for t, p in (payload.get("tiers") or {}).items()}}


async def _tier_apply(db: AsyncSession, actor_id: int, changes: dict, dry_run: bool):
    return await update_tier_rules(db, actor_id=actor_id, tiers=changes["tiers"], dry_run=dry_run)


async def _tier_snapshot(db: AsyncSession) -> dict:
    await tier_seed(db)
    rows = (await db.execute(select(SellerTierConfig).execution_options(populate_existing=True))).scalars()
    return {row.tier: row_values(row, skip={"tier", "badge"}) for row in rows}


register(ConfigSection(
    key="seller_tier_config", label="Quy tắc hạng người bán", audit_event="seller_tier_config_changed",
    href="/admin/seller-tiers", apply=_tier_apply, snapshot=_tier_snapshot,
    parse=_tier_parse, split=_tier_split, nested=True,
))


# ── seller trust score weights and tier criteria (one JSON document) ────────

async def _trust_apply(db: AsyncSession, actor_id: int, changes: dict, dry_run: bool):
    return await trust.update_config(db, changes, actor_id=actor_id, dry_run=dry_run)


async def _trust_snapshot(db: AsyncSession) -> dict:
    row = await fresh(db, SellerTrustConfig)
    # Normalised, so a document saved before the "auto" block existed reads
    # with its defaults and a request does not look stale because of them.
    return flatten(trust.validate_config(row.settings) if row is not None else trust.DEFAULT_CONFIG)


register(ConfigSection(
    key="seller_trust_config", label="Điểm uy tín & tiêu chí hạng", audit_event="seller_trust_config_changed",
    href="/admin/seller-tiers", apply=_trust_apply, snapshot=_trust_snapshot,
))


# ── buyer tiers: criterion, thresholds, cashback %, API limits (one document) ─

async def _buyer_tier_apply(db: AsyncSession, actor_id: int, changes: dict, dry_run: bool):
    return await buyer_tier_config.update_config(db, changes, actor_id=actor_id, dry_run=dry_run)


async def _buyer_tier_snapshot(db: AsyncSession) -> dict:
    row = await fresh(db, BuyerTierConfig)
    return flatten(buyer_tier_config.validate_config(row.settings) if row is not None else buyer_tier_config.DEFAULT_CONFIG)


register(ConfigSection(
    key="buyer_tier_config", label="Hạng người mua", audit_event="buyer_tier_config_changed",
    href="/admin/buyer-tiers", apply=_buyer_tier_apply, snapshot=_buyer_tier_snapshot,
))

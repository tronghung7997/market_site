from contextlib import asynccontextmanager

import structlog
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from fastapi import FastAPI, Header
from starlette.middleware.cors import CORSMiddleware

from src.alerts.router import router as alerts_router
from src.audit.router import router as audit_router
from src.affiliate.router import router as affiliate_router
from src.auth.router import router as auth_router
from src.categories.router import router as categories_router
from src.chat.router import router as chat_router
from src.config import settings
from src.debug.router import router as debug_router
from src.disputes.router import router as disputes_router
from src.gateway.router import router as gateway_router
from src.logging import setup_logging
from src.middleware import RequestIdMiddleware, SecurityHeadersMiddleware
from src.observability.sentry import init_sentry
from src.notifications.router import router as notifications_router
from src.orders.router import router as orders_router
from src.ops.router import router as ops_router
from src.pricing.router import router as pricing_router
from src.products.router import router as products_router
from src.providers.router import router as providers_router
from src.tasks.router import router as tasks_router
from src.resources.router import router as resources_router
from src.resources.proxy_router import router as proxy_router
from src.reviews.router import router as reviews_router
from src.payments.router import router as payments_router
from src.scheduler import (
    deposit_expire_job,
    deposit_reconcile_job,
    dproxy_reconciliation_job,
    escrow_release_job,
    gateway_call_log_cleanup_job,
    provider_credit_low_job,
    provision_sweep_job,
    resource_expire_job,
    sla_check_job,
    task_webhook_sla_job,
)
from src.errors.handlers import register_error_handlers
from src.security.crypto import using_default_encryption_key
from src.seller.router import router as seller_router
from src.seller_api_keys.router import router as seller_api_keys_router
from src.sellers.router import router as sellers_router
from src.usage.router import router as usage_router
from src.wallet.router import router as wallet_router
from src.money.router import router as money_router

# offline
from fastapi.openapi.docs import (
    get_redoc_html,
    get_swagger_ui_html,
    get_swagger_ui_oauth2_redirect_html,
)
from fastapi.staticfiles import StaticFiles

setup_logging()
init_sentry()

scheduler = AsyncIOScheduler()
scheduler.add_job(escrow_release_job, "interval", minutes=30, id="escrow_release")
scheduler.add_job(sla_check_job, "interval", minutes=10, id="sla_check")
# Provider-health polling is deliberately paused: its current probes can
# report an untested/billable provider as healthy, while persisting 96 rows per
# provider per day without retention. Keep manual provider tests available;
# re-enable this only with a trustworthy signal model and bounded retention.
scheduler.add_job(resource_expire_job, "interval", minutes=15, id="resource_expire")
scheduler.add_job(provision_sweep_job, "interval", minutes=2, id="provision_sweep")
scheduler.add_job(task_webhook_sla_job, "interval", minutes=30, id="task_webhook_sla")
scheduler.add_job(dproxy_reconciliation_job, "interval", minutes=15, id="dproxy_reconciliation")
scheduler.add_job(deposit_reconcile_job, "interval", minutes=5, id="deposit_reconcile")
scheduler.add_job(deposit_expire_job, "interval", minutes=10, id="deposit_expire")
scheduler.add_job(provider_credit_low_job, "interval", minutes=15, id="provider_credit_low")
# Operational log retention (gateway/provider call logs, log_entries, resolved alerts).
scheduler.add_job(gateway_call_log_cleanup_job, "interval", hours=6, id="gateway_call_log_cleanup")


@asynccontextmanager
async def lifespan(app):
    if using_default_encryption_key():
        # Provider credentials are encrypted with a key derived from this value,
        # so switching it later strands every api_key already stored — there is
        # no recovery beyond re-entering each provider by hand.
        structlog.get_logger().warning(
            "insecure_default_encryption_key",
            detail="ENCRYPTION_KEY chưa được set — provider credential đang mã hoá bằng "
                   "khoá mặc định. Set trước khi thêm provider thật: đổi khoá về sau sẽ "
                   "làm hỏng toàn bộ credential đã lưu.",
        )
    scheduler.start()
    yield
    scheduler.shutdown()


app = FastAPI(
    title=settings.service_name,
    lifespan=lifespan,
    docs_url=None,
    redoc_url=None,
    openapi_url="/openapi.json" if settings.api_docs_enabled else None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=[
        "Authorization",
        "Content-Type",
        "X-Request-ID",
        "X-Seller-Api-Key",  # legacy — remove after LEGACY_SELLER_API_KEY_MODE=deny rollout
        "X-API-Key",
        "X-Timestamp",
        "X-Signature",
    ],
)
app.add_middleware(
    SecurityHeadersMiddleware,
    enable_hsts=settings.deployment_environment == "production",
)
app.add_middleware(RequestIdMiddleware)

register_error_handlers(app)

app.include_router(auth_router)
app.include_router(seller_router)
app.include_router(seller_api_keys_router)
app.include_router(sellers_router)
app.include_router(wallet_router)
app.include_router(money_router)
app.include_router(payments_router)
app.include_router(categories_router)
app.include_router(chat_router)
app.include_router(products_router)
app.include_router(resources_router)
app.include_router(notifications_router)
app.include_router(orders_router)
app.include_router(disputes_router)
app.include_router(providers_router)
app.include_router(pricing_router)
app.include_router(tasks_router)
app.include_router(alerts_router)
app.include_router(reviews_router)
app.include_router(audit_router)
app.include_router(affiliate_router)
if settings.debug_routes_enabled:
    app.include_router(debug_router)
app.include_router(usage_router)
app.include_router(gateway_router)
app.include_router(proxy_router)
app.include_router(ops_router)


@app.get("/health")
async def health():
    return {"status": "ok", "service": settings.service_name}


@app.get("/internal/metrics", include_in_schema=False)
async def internal_metrics(x_internal_key: str = Header(...)):
    """Prometheus text metrics — requires X-Internal-Key.

    Not published anonymously; scrape from private network only.
    """
    import hmac as _hmac

    from fastapi import Response
    from src.observability.metrics import render_prometheus

    if not _hmac.compare_digest(x_internal_key, settings.internal_api_key):
        from fastapi import HTTPException
        raise HTTPException(status_code=403, detail="Khoá nội bộ không hợp lệ")
    return Response(content=render_prometheus(), media_type="text/plain; version=0.0.4")

if settings.api_docs_enabled:
    # Bundled assets keep optional development docs offline. Production and
    # staging default to no OpenAPI route at all.
    app.mount("/static", StaticFiles(directory="static"), name="static")

    @app.get("/docs", include_in_schema=False)
    async def custom_swagger_ui_html():
        return get_swagger_ui_html(
            openapi_url=app.openapi_url,
            title=f"{app.title} API docs",
            oauth2_redirect_url=app.swagger_ui_oauth2_redirect_url,
            swagger_js_url="/static/swagger-ui-bundle.js",
            swagger_css_url="/static/swagger-ui.css",
        )

    @app.get(app.swagger_ui_oauth2_redirect_url, include_in_schema=False)
    async def swagger_ui_redirect():
        return get_swagger_ui_oauth2_redirect_html()

    @app.get("/redoc", include_in_schema=False)
    async def redoc_html():
        return get_redoc_html(
            openapi_url=app.openapi_url,
            title=app.title + " - ReDoc",
            redoc_js_url="/static/redoc.standalone.js",
        )
#

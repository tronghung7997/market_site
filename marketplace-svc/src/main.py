from contextlib import asynccontextmanager

import structlog
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from fastapi import FastAPI
from starlette.middleware.cors import CORSMiddleware

from src.alerts.router import router as alerts_router
from src.audit.router import router as audit_router
from src.affiliate.router import router as affiliate_router
from src.auth.router import router as auth_router
from src.categories.router import router as categories_router
from src.config import settings
from src.debug.router import router as debug_router
from src.disputes.router import router as disputes_router
from src.gateway.router import router as gateway_router
from src.logging import setup_logging
from src.middleware import RequestIdMiddleware
from src.notifications.router import router as notifications_router
from src.orders.router import router as orders_router
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
    health_check_job,
    provider_credit_low_job,
    provider_scoring_job,
    provision_sweep_job,
    resource_expire_job,
    sla_check_job,
    task_webhook_sla_job,
)
from src.security.crypto import using_default_encryption_key
from src.seller.router import router as seller_router
from src.seller_api_keys.router import router as seller_api_keys_router
from src.sellers.router import router as sellers_router
from src.usage.router import router as usage_router
from src.wallet.router import router as wallet_router

# offline
from fastapi.openapi.docs import (
    get_redoc_html,
    get_swagger_ui_html,
    get_swagger_ui_oauth2_redirect_html,
)
from fastapi.staticfiles import StaticFiles

setup_logging()

scheduler = AsyncIOScheduler()
scheduler.add_job(escrow_release_job, "interval", minutes=30, id="escrow_release")
scheduler.add_job(sla_check_job, "interval", minutes=10, id="sla_check")
scheduler.add_job(health_check_job, "interval", minutes=15, id="health_check")
scheduler.add_job(resource_expire_job, "interval", minutes=15, id="resource_expire")
scheduler.add_job(provider_scoring_job, "interval", minutes=15, id="provider_scoring")
scheduler.add_job(provision_sweep_job, "interval", minutes=2, id="provision_sweep")
scheduler.add_job(task_webhook_sla_job, "interval", minutes=30, id="task_webhook_sla")
scheduler.add_job(dproxy_reconciliation_job, "interval", minutes=15, id="dproxy_reconciliation")
scheduler.add_job(deposit_reconcile_job, "interval", minutes=5, id="deposit_reconcile")
scheduler.add_job(deposit_expire_job, "interval", minutes=10, id="deposit_expire")
scheduler.add_job(provider_credit_low_job, "interval", minutes=15, id="provider_credit_low")
# Bảng lịch sử tiện lợi, không phải billing ledger — dọn thưa (6h/lần) là đủ,
# không cần sát sao như các job trên (xem settings.gateway_call_log_retention_days).
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


app = FastAPI(title=settings.service_name, lifespan=lifespan, docs_url=None, redoc_url=None)

app.add_middleware(RequestIdMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(seller_router)
app.include_router(seller_api_keys_router)
app.include_router(sellers_router)
app.include_router(wallet_router)
app.include_router(payments_router)
app.include_router(categories_router)
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
app.include_router(debug_router)
app.include_router(usage_router)
app.include_router(gateway_router)
app.include_router(proxy_router)


@app.get("/health")
async def health():
    return {"status": "ok", "service": settings.service_name}

# Static UI
app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/docs", include_in_schema=False)
async def custom_swagger_ui_html():
    return get_swagger_ui_html(
        openapi_url=app.openapi_url,
        title="This is my town now !!!",
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
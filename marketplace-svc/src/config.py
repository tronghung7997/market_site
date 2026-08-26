from typing import Literal
from urllib.parse import urlsplit

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


_KNOWN_INSECURE_SECRETS = {
    "dev-secret-change-in-production",
    "dev-internal-key",
    "dev-encryption-key-change-in-production",
}
_MIN_SECRET_LENGTH = 32


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    deployment_environment: Literal["development", "test", "staging", "production"] = "development"
    service_name: str = "marketplace-svc"
    database_url: str = "postgresql+asyncpg://marketplace:marketplace@localhost:5432/marketplace"
    # Chỉ dùng cho rate-limit gateway (src/rate_limit.py) — best-effort,
    # Redis chết thì gateway vẫn chạy, chỉ mất chặn abuse.
    redis_url: str = "redis://localhost:6379"
    # No usable defaults: every environment must inject unique values.
    jwt_secret: str
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60
    internal_api_key: str
    bff_request_signing_secret: str
    bff_request_signing_key_id: str = "market-bff-v1"
    bff_request_signing_timestamp_tolerance_seconds: int = 300
    platform_fee_percent: int = 0
    encryption_key: str
    # Dedicated secret for login principal fingerprinting (S telemetry).
    # Falls back to jwt_secret only when unset so existing deployments boot;
    # production should set PRINCIPAL_HMAC_SECRET independently.
    principal_hmac_secret: str = ""
    frontend_base_url: str = "http://localhost:3000"
    # Comma-separated because pydantic-settings otherwise expects JSON for a list.
    # Empty means FRONTEND_BASE_URL only.
    cors_allowed_origins: str = ""
    api_docs_enabled: bool = False
    debug_routes_enabled: bool = False
    auth_rate_limit_enabled: bool = True
    auth_rate_limit_window_seconds: int = 300
    auth_login_ip_limit: int = 20
    auth_login_account_limit: int = 8
    auth_register_ip_limit: int = 10
    auth_refresh_account_limit: int = 30
    auth_forgot_ip_limit: int = 10
    auth_forgot_account_limit: int = 5
    auth_reset_ip_limit: int = 20
    password_reset_ttl_minutes: int = 30
    # Outbound transactional mail (SMTP or HTTPS). Inbound ports are not required.
    mail_provider: Literal["log", "smtp", "resend"] = "log"
    mail_from: str = ""
    mail_from_name: str = "Proxora"
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_starttls: bool = True
    resend_api_key: str = ""
    mail_worker_enabled: bool = True
    mail_max_attempts: int = 8
    gateway_ip_rate_limit: int = 120
    gateway_key_rate_limit: int = 60
    # Comma-separated IPs/CIDRs of reverse proxies allowed to set X-Forwarded-For.
    # Empty = never trust XFF (rate limits use the direct TCP peer only).
    # Behind nginx, set the proxy's address/CIDR so per-client IP buckets work.
    trusted_proxy_cidrs: str = ""
    # Exact public IPs allowed to reach /auth/admin/login and /admin/*.
    # Empty keeps the allowlist disabled for local development and rollout.
    admin_allowed_ips: str = ""
    affiliate_click_ip_limit: int = 30
    provider_webhook_ip_limit: int = 120
    # Used to build the callback_url a seller_task_webhook provider POSTs back to.
    backend_base_url: str = "http://localhost:8001"
    default_affiliate_commission_percent: float = 0.0

    # --- SePay bank Webhooks + VietQR ---
    # Beneficiary shown to buyers and embedded in every QR: either the real
    # bank account number or an official VA number. The UUID is always the
    # parent SePay API v2 bank_account_id used to scope reconciliation queries.
    # Bootstrap/fallback only: live destination is stored in deposit_rail_config.
    sepay_bank_code: str = ""
    sepay_bank_account_number: str = ""
    sepay_bank_account_name: str = ""
    sepay_bank_account_id: str = ""
    sepay_payment_code_prefix: str = "NAP"
    sepay_webhook_secret: str = ""
    sepay_webhook_timestamp_tolerance_seconds: int = 300
    sepay_api_token: str = ""
    # Sandbox: https://userapi-sandbox.sepay.vn
    sepay_api_base_url: str = "https://userapi.sepay.vn"
    sepay_vietqr_base_url: str = "https://vietqr.app/img"

    # --- Legacy PayOS (read/reconcile old intents during cutover only) ---
    # New bank deposits never use these values. Keep them temporarily so an
    # already-created PayOS intent can still be cancelled or reconciled.
    payos_client_id: str = ""
    payos_api_key: str = ""
    payos_checksum_key: str = ""
    payos_base_url: str = "https://api-merchant.payos.vn"
    deposit_min_amount: int = 10_000
    # Trần một lệnh nạp — chặn gõ thừa số 0 (nạp 500 triệu thay vì 5 triệu là
    # thảm hoạ hỗ trợ khách hàng, và bank/PayOS cũng có hạn mức riêng).
    deposit_max_amount: int = 100_000_000
    deposit_max_pending_per_account: int = 3
    deposit_expire_minutes: int = 30
    # Lệnh đã expired/cancelled nhưng CHƯA thấy tiền vẫn được đối soát lại
    # trong cửa sổ này — webhook có thể bị nuốt trong lúc backend outage và
    # expire job chạy trước khi PayOS kịp báo (review 24/07 #2).
    deposit_reconcile_retention_hours: int = 48
    # demo-topup là đường nạp giả cho dev/demo — PHẢI tắt ở production.
    enable_demo_topup: bool = False

    # --- NOWPayments USDT (docs/superpowers/plans/2026-08-11-nowpayments-usdt-deposit-plan.md) ---
    # Outcome wallet merchant phải khớp NOWPAYMENTS_OUTCOME_CURRENCY (phase 1: usdtbsc).
    # Flag off → method=nowpayments trả 503; FE ẩn rail USDT.
    nowpayments_enabled: bool = False
    nowpayments_api_key: str = ""
    nowpayments_ipn_secret: str = ""
    # Used only to obtain a short-lived NOW JWT for automatic invoice reconciliation.
    # Keep these deployment secrets server-side; never expose them through the admin API.
    nowpayments_auth_email: str = ""
    nowpayments_auth_password: str = ""
    nowpayments_base_url: str = "https://api.nowpayments.io/v1"
    # Optional full IPN URL override; empty → {backend_base_url}/webhooks/nowpayments
    nowpayments_ipn_url: str = ""
    # Outcome wallet merchant must match this NOW currency code (e.g. usdtbsc).
    # Buyer network selection is controlled in NOWPayments coin settings, not here.
    nowpayments_outcome_currency: str = "usdtbsc"
    deposit_usdt_min_vnd: int = 50_000
    deposit_usdt_max_vnd: int = 50_000_000
    # Local UI window only — NOT provider payment TTL (see contract verification).
    deposit_usdt_local_window_minutes: int = 60
    # Reconcile unfinished NOW intents (pending/expired/cancelled unpaid) within this window.
    deposit_usdt_reconcile_retention_hours: int = 192

    # --- TopProxy ---
    # Tiền tố marker nhét vào username proxy tĩnh (`{prefix}{order_id}`) để
    # nhận lại đúng con proxy của một đơn khi retry. Marker được tra bằng
    # listproxy trên TOÀN BỘ tài khoản TopProxy, nên hai môi trường dùng chung
    # một API key mà cùng prefix sẽ đá nhau: order #12 ở staging khớp marker
    # `od12` của proxy prod còn hạn và được "nhận lại" mà không mua gì. Đặt
    # khác nhau cho mỗi môi trường (vd TOPPROXY_MARKER_PREFIX=stg).
    topproxy_marker_prefix: str = "od"

    # --- Gateway call history (buyer-facing, src/models/usage.py::GatewayCallLog) ---
    # Recent-request convenience log, NOT the billing ledger (usage_records —
    # never pruned). Bounded on purpose so it can't grow unbounded on a busy
    # gateway product; raise it if buyers need to look back further, or drop
    # it if disk isn't a concern.
    gateway_call_log_retention_days: int = 7
    # Retention for operational tables (WP6). Money ledgers are never purged here.
    provider_call_log_retention_days: int = 30
    log_entry_retention_days: int = 180
    resolved_alert_retention_days: int = 90
    # Optional Sentry DSN (WP7). Empty = disabled.
    sentry_dsn: str = ""

    # --- Display FX (USD show / VND ledger) ---
    # VND per 1 USD. Seeds display_money_config on first boot only; never
    # overwrites a DB rate on restart. Admin PATCH is the production source.
    display_fx_rate: int = 25_500
    display_fx_rate_min: int = 10_000
    display_fx_rate_max: int = 50_000
    display_currency_default: str = "USD"
    display_allow_user_toggle: bool = True
    # Language switcher (EN|VI) in TopNav — off by default until product enables it.
    display_allow_locale_toggle: bool = False
    # Buyer UI FX/VND conversion hints (rate tooltip, ≈ VND under USD inputs).
    # False = pure USD chrome — visitors never see VND/rate copy.
    display_show_fx_hints: bool = True

    @property
    def cors_origins(self) -> list[str]:
        configured = [origin.strip().rstrip("/") for origin in self.cors_allowed_origins.split(",")]
        origins = [origin for origin in configured if origin]
        return origins or [self.frontend_base_url.rstrip("/")]

    @model_validator(mode="after")
    def validate_security_settings(self) -> "Settings":
        for field_name in ("jwt_secret", "internal_api_key", "encryption_key", "bff_request_signing_secret"):
            value = getattr(self, field_name)
            if value in _KNOWN_INSECURE_SECRETS:
                raise ValueError(f"{field_name.upper()} uses a known insecure default")
            if len(value.encode()) < _MIN_SECRET_LENGTH:
                raise ValueError(
                    f"{field_name.upper()} must contain at least {_MIN_SECRET_LENGTH} bytes"
                )
        if self.bff_request_signing_secret in {
            self.jwt_secret,
            self.internal_api_key,
            self.encryption_key,
        }:
            raise ValueError("BFF_REQUEST_SIGNING_SECRET must differ from every other service secret")

        if not self.principal_hmac_secret:
            object.__setattr__(self, "principal_hmac_secret", self.jwt_secret)
        if len(self.principal_hmac_secret.encode()) < _MIN_SECRET_LENGTH:
            raise ValueError(
                f"PRINCIPAL_HMAC_SECRET must contain at least {_MIN_SECRET_LENGTH} bytes"
            )

        if self.jwt_algorithm != "HS256":
            raise ValueError("JWT_ALGORITHM must remain HS256 until asymmetric-key support is implemented")
        if self.deployment_environment in {"staging", "production"} and self.enable_demo_topup:
            raise ValueError("ENABLE_DEMO_TOPUP must be false outside development/test")
        if self.deployment_environment in {"staging", "production"} and not self.auth_rate_limit_enabled:
            raise ValueError("AUTH_RATE_LIMIT_ENABLED must be true outside development/test")
        if any(origin == "*" for origin in self.cors_origins):
            raise ValueError("CORS_ALLOWED_ORIGINS must not contain '*'")
        if self.deployment_environment == "production":
            if self.api_docs_enabled or self.debug_routes_enabled:
                raise ValueError("API docs and debug routes must be disabled in production")
            for origin in self.cors_origins:
                parsed = urlsplit(origin)
                if parsed.scheme != "https" or parsed.hostname in {"localhost", "127.0.0.1", "::1"}:
                    raise ValueError("Production CORS origins must be public HTTPS URLs")
            backend = urlsplit(self.backend_base_url)
            if backend.scheme != "https" or backend.hostname in {"localhost", "127.0.0.1", "::1"}:
                raise ValueError("BACKEND_BASE_URL must be a public HTTPS URL in production")
        for field_name in (
            "auth_rate_limit_window_seconds",
            "auth_login_ip_limit",
            "auth_login_account_limit",
            "auth_register_ip_limit",
            "auth_refresh_account_limit",
            "auth_forgot_ip_limit",
            "auth_forgot_account_limit",
            "auth_reset_ip_limit",
            "password_reset_ttl_minutes",
            "smtp_port",
            "mail_max_attempts",
            "gateway_ip_rate_limit",
            "gateway_key_rate_limit",
            "sepay_webhook_timestamp_tolerance_seconds",
            "bff_request_signing_timestamp_tolerance_seconds",
            "affiliate_click_ip_limit",
            "provider_webhook_ip_limit",
            "gateway_call_log_retention_days",
            "provider_call_log_retention_days",
            "log_entry_retention_days",
            "resolved_alert_retention_days",
        ):
            if getattr(self, field_name) <= 0:
                raise ValueError(f"{field_name.upper()} must be greater than zero")

        # Fail at boot on bad CIDRs — not on the first rate-limited request.
        from src.security.admin_access import parse_admin_allowed_ips
        from src.security.client_ip import parse_trusted_proxy_cidrs
        parse_trusted_proxy_cidrs(self.trusted_proxy_cidrs)
        parse_admin_allowed_ips(self.admin_allowed_ips)

        return self


settings = Settings()

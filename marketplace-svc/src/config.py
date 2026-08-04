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
    gateway_ip_rate_limit: int = 120
    gateway_key_rate_limit: int = 60
    affiliate_click_ip_limit: int = 30
    provider_webhook_ip_limit: int = 120
    # Used to build the callback_url a seller_task_webhook provider POSTs back to.
    backend_base_url: str = "http://localhost:8001"
    default_affiliate_commission_percent: float = 0.0

    # --- PayOS (docs/superpowers/specs/2026-07-23-bank-payment-design.md) ---
    # Lấy 3 giá trị từ kênh thanh toán trên https://my.payos.vn. Để trống =
    # chưa cấu hình: tạo lệnh nạp trả 503, job đối soát tự bỏ qua.
    payos_client_id: str = ""
    payos_api_key: str = ""
    payos_checksum_key: str = ""
    # Dev trỏ vào scripts/mock_payos.py (http://127.0.0.1:9400)
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

    @property
    def cors_origins(self) -> list[str]:
        configured = [origin.strip().rstrip("/") for origin in self.cors_allowed_origins.split(",")]
        origins = [origin for origin in configured if origin]
        return origins or [self.frontend_base_url.rstrip("/")]

    @model_validator(mode="after")
    def validate_security_settings(self) -> "Settings":
        for field_name in ("jwt_secret", "internal_api_key", "encryption_key"):
            value = getattr(self, field_name)
            if value in _KNOWN_INSECURE_SECRETS:
                raise ValueError(f"{field_name.upper()} uses a known insecure default")
            if len(value.encode()) < _MIN_SECRET_LENGTH:
                raise ValueError(
                    f"{field_name.upper()} must contain at least {_MIN_SECRET_LENGTH} bytes"
                )

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
            "gateway_ip_rate_limit",
            "gateway_key_rate_limit",
            "affiliate_click_ip_limit",
            "provider_webhook_ip_limit",
            "gateway_call_log_retention_days",
            "provider_call_log_retention_days",
            "log_entry_retention_days",
            "resolved_alert_retention_days",
        ):
            if getattr(self, field_name) <= 0:
                raise ValueError(f"{field_name.upper()} must be greater than zero")
        return self


settings = Settings()

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    service_name: str = "marketplace-svc"
    database_url: str = "postgresql+asyncpg://marketplace:marketplace@localhost:5432/marketplace"
    redis_url: str = "redis://localhost:6379"
    rabbitmq_url: str = "amqp://guest:guest@localhost:5672/"
    jwt_secret: str = "dev-secret-change-in-production"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 1440
    internal_api_key: str = "dev-internal-key"
    platform_fee_percent: int = 0
    encryption_key: str = "dev-encryption-key-change-in-production"
    frontend_base_url: str = "http://localhost:3000"
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


settings = Settings()

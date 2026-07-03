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
    default_affiliate_commission_percent: float = 0.0


settings = Settings()

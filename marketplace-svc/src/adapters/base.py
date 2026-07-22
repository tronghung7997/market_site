from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime


@dataclass
class ProvisionResult:
    success: bool
    data: str | None = None
    resource_id: str | None = None
    metadata: dict | None = field(default_factory=dict)
    error: str | None = None


class ProviderAdapter(ABC):
    def __init__(self, config: dict):
        self.config = config

    @abstractmethod
    async def provision(self, order_id: int, user_config: dict) -> ProvisionResult:
        ...

    @abstractmethod
    async def check_health(self) -> dict:
        ...

    @abstractmethod
    async def get_usage(self, resource_id: str) -> dict | None:
        ...

    @abstractmethod
    async def revoke(self, resource_id: str) -> bool:
        ...


@dataclass(frozen=True)
class ProxyAssignment:
    """One normalized, already-validated upstream proxy assignment — see
    docs/superpowers/specs/2026-07-22-dproxy-integration.md. Adapter-agnostic
    on purpose: a second rotatable-proxy supplier would produce the same
    shape, so nothing above this needs to know DProxy's wire format."""

    external_id: str
    proxy_id: str | None
    host: str
    port: int
    username: str
    password: str
    public_ip: str | None
    assigned_at: datetime | None
    expires_at: datetime
    rotation_available: bool
    rotation_mode: str | None
    cooldown_seconds: int | None
    last_rotated_at: datetime | None
    rotate_path: str | None

    def delivered_text(self) -> str:
        """Buyer-safe credential snapshot for Order.delivered_data — never
        includes rotate_path, proxy_id, or anything that isn't needed to
        actually use the proxy."""
        lines = [
            f"Host: {self.host}",
            f"Port: {self.port}",
            f"Username: {self.username}",
            f"Password: {self.password}",
        ]
        if self.public_ip:
            lines.append(f"IP hiện tại: {self.public_ip}")
        lines.append(f"Hết hạn: {self.expires_at.isoformat()}")
        return "\n".join(lines)


class RotatableProxyAdapter(ProviderAdapter, ABC):
    """Capability mixin for adapters backing a purchasable, rotatable proxy
    assignment (src/resources/proxy_service.py, src/resources/proxy_router.py)."""

    @abstractmethod
    async def list_assignments(self) -> list[ProxyAssignment]:
        ...

    @abstractmethod
    async def rotate_assignment(self, external_id: str) -> ProxyAssignment:
        ...

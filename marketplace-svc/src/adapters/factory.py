from sqlalchemy.ext.asyncio import AsyncSession

from src.adapters.base import ProviderAdapter
from src.adapters.registry import get_spec
from src.models.provider import Provider

MAX_FALLBACK_DEPTH = 3


async def get_adapter(provider_id: int, db: AsyncSession) -> ProviderAdapter:
    """Load a provider from DB and return the matching adapter instance.

    If the provider is inactive and has a fallback, follow the chain (max 3 hops).
    """
    visited: set[int] = set()
    current_id = provider_id

    for _ in range(MAX_FALLBACK_DEPTH + 1):
        if current_id in visited:
            raise ValueError(f"Circular fallback detected at provider {current_id}")
        visited.add(current_id)

        provider = await db.get(Provider, current_id)
        if provider is None:
            raise ValueError(f"Provider {current_id} not found")

        if provider.is_active:
            return _instantiate(provider, db)

        # Inactive — try fallback
        if provider.fallback_provider_id is not None:
            current_id = provider.fallback_provider_id
        else:
            raise ValueError(
                f"Provider {provider.name} (id={provider.id}) is inactive with no fallback"
            )

    raise ValueError(f"Fallback chain exceeded max depth ({MAX_FALLBACK_DEPTH})")


async def get_binding_adapter(provider_id: int, db: AsyncSession) -> ProviderAdapter:
    """Adapter cho một BINDING đã bán (rotate/whitelist/tra cứu proxy của đơn
    đã giao) — khác get_adapter ở hai điểm cố ý:

    - KHÔNG check `is_active`: provider bị tắt (hết Xu, health check fail) chỉ
      có nghĩa là ngừng nhận ĐƠN MỚI. Buyer đã trả tiền vẫn có quyền đổi IP /
      khai báo whitelist trên key còn hạn — các lệnh đó không tốn Xu.
    - KHÔNG đi fallback chain: fallback chỉ có nghĩa cho provision đơn mới.
      Đưa keyxoay của provider này sang adapter của provider khác là chắc chắn
      "key không tồn tại" — buyer thấy "proxy hết hiệu lực" trong khi key vẫn
      sống nguyên bên nhà cung cấp gốc.
    """
    provider = await db.get(Provider, provider_id)
    if provider is None:
        raise ValueError(f"Provider {provider_id} not found")
    return _instantiate(provider, db)


async def get_adapter_for_test(provider_id: int, db: AsyncSession) -> ProviderAdapter:
    """Adapter cho nút Test (admin + seller self-service) — cố tình KHÔNG check
    `is_active` và KHÔNG đi fallback chain, khác `get_adapter`.

    Test dùng để CHẨN ĐOÁN một provider, kể cả provider đang bị tắt (health
    check job tự tắt sau 3 lần liên tiếp unhealthy — xem scheduler.py). Nếu
    dùng get_adapter() ở đây, provider vừa bị tắt sẽ không thể tự test lại để
    xác nhận đã sửa xong chưa — phải bật mù rồi mới test được, ngược quy trình.
    """
    provider = await db.get(Provider, provider_id)
    if provider is None:
        raise ValueError(f"Provider {provider_id} not found")
    return _instantiate(provider, db)


def _instantiate(provider: Provider, db: AsyncSession) -> ProviderAdapter:
    spec = get_spec(provider.adapter_type)
    if spec is None:
        raise ValueError(f"Unknown adapter_type: {provider.adapter_type!r}")

    # Chữ ký chung cho MỌI adapter (adapters/base.py) — thêm adapter mới không
    # cần dạy factory cách khởi tạo nó.
    return spec.cls(
        provider.config or {},
        db=db,
        provider_id=provider.id,
        seller_owned=provider.seller_id is not None,
    )

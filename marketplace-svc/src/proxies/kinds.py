"""Loại proxy buyer thấy — 3 chiều cố định trong code.

- `ip_type`: residential | mobile | datacenter — loại IP của gói đã bán.
- `rotation`: static | rotating | rotating_key. `rotating_key` = key xoay qua
  cổng cố định (TopProxy xoay) và được chốt lúc giao. static/rotating KHÔNG
  chốt: DProxy nói cùng một gói có lúc giao node xoay, có lúc tĩnh, nên chiều
  này đọc từ node thật (`rotation_available`, reconciliation cập nhật).
- `country` / `network`: nhãn gói (network_display) — DProxy không khai quốc gia.

Buyer không bao giờ thấy nguồn: mọi thứ ở đây suy từ GÓI buyer đã mua
(`type|network|days` của pricing config), không từ tên nhà cung cấp. Nhãn
hiển thị do frontend ghép từ các chiều (i18n).
"""
from __future__ import annotations

import re
from dataclasses import dataclass

IP_TYPES = ("residential", "mobile", "datacenter")
ROTATIONS = ("static", "rotating", "rotating_key")
PROTOCOLS = ("HTTP", "SOCKS5")

# Mã loại/nhà mạng TopProxy tĩnh (`loaiproxy`) → loại IP + quốc gia.
_TOPPROXY_STATIC = {
    "Viettel": ("residential", "VN"), "FPT": ("residential", "VN"), "VNPT": ("residential", "VN"),
    "GoiViettel": ("residential", "VN"), "GoiVNPT": ("residential", "VN"), "GoiFPT": ("residential", "VN"),
    "DatacenterA": ("datacenter", "VN"), "DatacenterB": ("datacenter", "VN"), "DatacenterC": ("datacenter", "VN"),
    "GoiDATACENTER": ("datacenter", "VN"), "US": ("datacenter", "US"), "4Gvinaphone": ("mobile", "VN"),
}


@dataclass(frozen=True)
class LineKind:
    ip_type: str
    rotation_kind: str | None  # chỉ "rotating_key" được chốt; None = đọc từ node
    protocol: str
    country: str | None
    network_label: str | None
    plan_days: int | None
    plan_label: str | None


def ip_type_from_code(code: str | None) -> str:
    """Mã loại của gói (`residential`, `mobile`, `datacenter`, `4g`, `dc`…) → ip_type."""
    text = (code or "").strip().lower()
    words = set(re.split(r"[^0-9a-zà-ỹđ]+", text))
    if words & {"mobile", "4g", "5g"} or "di động" in text or "di dong" in text:
        return "mobile"
    if ("datacenter" in text or "data center" in text or "dc" in words) and "residential" not in text:
        return "datacenter"
    return "residential"


def _country_from_network(network: str | None) -> str | None:
    code = (network or "").strip()
    return code.upper() if len(code) == 2 and code.isalpha() else None


def rotation_for(rotation_kind: str | None, rotation_available: bool) -> str:
    if rotation_kind == "rotating_key":
        return "rotating_key"
    return "rotating" if rotation_available else "static"


def classify(
    adapter_type: str | None, user_config: dict | None, pricing_params: dict | None, *, provider_mode: str | None = None,
) -> LineKind:
    """Loại của MỘT dòng proxy từ gói buyer đã chọn (`type|network|days`).

    `provider_mode` = `config.mode` của provider TopProxy: nguồn `xoay` bán key
    xoay với MỌI mã nhà mạng (đơn cũ lưu `network: "Random"`), không chỉ mã `xoay`
    của bảng gói mới."""
    cfg = user_config or {}
    params = pricing_params or {}
    proxy_type = str(cfg.get("type") or "")
    network = str(cfg.get("network") or "")
    try:
        days = int(cfg.get("days")) if cfg.get("days") not in (None, "") else None
    except (TypeError, ValueError):
        days = None
    is_key = adapter_type == "topproxy" and (network == "xoay" or provider_mode == "xoay")
    type_display = (params.get("type_display") or {}).get(proxy_type)
    network_display = (params.get("network_display") or {}).get(network)
    if is_key and network in ("xoay", ""):
        network_display = network_display or "Key xoay"
    network_label = (network_display or network or None)
    plan_label = " · ".join(p for p in (type_display or proxy_type, network_display or network, f"{days} ngày" if days else "") if p) or None

    if adapter_type == "topproxy":
        protocol = proxy_type.upper() if proxy_type.upper() in PROTOCOLS else "HTTP"
        if is_key:
            return LineKind("residential", "rotating_key", protocol, "VN", network_display or network or None, days, plan_label)
        ip_type, country = _TOPPROXY_STATIC.get(network, ("residential", "VN"))
        return LineKind(ip_type, None, protocol, country, network_label, days, plan_label)

    # DProxy (và nguồn proxy khác bán theo plan): mã loại chính là loại IP.
    return LineKind(
        ip_type_from_code(proxy_type), None, "HTTP", _country_from_network(network),
        network_label, days, plan_label,
    )

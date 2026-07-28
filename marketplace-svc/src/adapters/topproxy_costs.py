"""Giá vốn TopProxy (Xu) — bảng tra để ước tính số Xu mỗi lệnh mua tiêu tốn.

Nguồn: `docs/topproxy-catalog.md` §2E/§2F/§2G, dump từ hàm tính giá trên web
topproxy.vn ngày 2026-07-24. 1 Xu ≈ 1 VND.

Dùng cho SỔ XU ƯỚC TÍNH (src/providers/credit.py): TopProxy KHÔNG có API xem
số dư, nên cách duy nhất biết sắp hết tiền là tự trừ dần từ con số admin nhập
vào sau mỗi lần nạp.

ĐÂY LÀ ƯỚC TÍNH, KHÔNG PHẢI KẾ TOÁN. Nó sẽ trôi số vì:
- gia hạn/mua tay trực tiếp trên web không đi qua hệ thống này,
- TopProxy đổi giá hoặc kết thúc khuyến mãi (4G và key xoay đang ×0.5),
mà mình không có cách nào biết. Admin nhập lại số dư thật định kỳ để đồng bộ.

Giá theo BẬC THANG: mua càng dài thì đơn giá/ngày càng rẻ. Mỗi bảng là danh
sách (số ngày tối thiểu, Xu mỗi ngày) — tra bậc lớn nhất mà `days` đạt tới.
"""

# (min_days, xu_per_day) — phải sắp xếp tăng dần theo min_days.
_LADDERS: dict[str, list[tuple[int, int]]] = {
    # Dân cư share, mọi nhà mạng (catalog §2G dòng 1)
    "residential_share": [
        (1, 800), (5, 720), (10, 640), (20, 560), (30, 480),
        (45, 440), (60, 400), (90, 360), (120, 320),
    ],
    "datacenter_private": [
        (1, 2800), (5, 2560), (15, 2400), (30, 1600), (90, 1440), (120, 1360),
    ],
    "datacenter_share3": [
        (1, 800), (5, 640), (10, 480), (20, 400), (30, 320),
        (45, 300), (60, 280), (90, 260), (120, 240),
    ],
    "us": [
        (1, 480), (5, 400), (10, 320), (20, 240), (30, 160),
    ],
    # ĐANG KHUYẾN MÃI ×0.5 — hết KM phải nhân đôi lại (catalog §2G ghi chú).
    "mobile_4g": [
        (1, 2500), (5, 2000), (10, 1500), (20, 1300), (30, 1000),
        (45, 900), (60, 800), (90, 700), (120, 600),
    ],
}

# `loaiproxy` (khớp apiv2) → bảng bậc thang.
_STATIC_LADDER_BY_LOAIPROXY: dict[str, str] = {
    "Viettel": "residential_share",
    "FPT": "residential_share",
    "VNPT": "residential_share",
    "DatacenterA": "datacenter_private",
    "DatacenterB": "residential_share",  # Share1 cùng bậc với dân cư share
    "DatacenterC": "datacenter_share3",
    "US": "us",
    "4Gvinaphone": "mobile_4g",
}

# Combo bán theo GÓI, giá cố định cho 30 ngày (catalog §2E) — không có bậc thang.
_PACKAGE_COST_PER_30_DAYS: dict[str, int] = {
    "GoiViettel": 675_000,
    "GoiVNPT": 675_000,
    "GoiFPT": 675_000,
    "GoiDATACENTER": 480_000,
}

# Key xoay (catalog §2F) — cũng đang khuyến mãi ×0.5.
_XOAY_COST_PER_UNIT: dict[str, int] = {
    "day": 2_500,
    "week": 14_000,
    "month": 45_000,
}


def _rate_from_ladder(ladder: list[tuple[int, int]], days: int) -> int:
    rate = ladder[0][1]
    for min_days, xu_per_day in ladder:
        if days >= min_days:
            rate = xu_per_day
        else:
            break
    return rate


def static_cost_xu(loaiproxy: str, days: int) -> int | None:
    """Giá vốn ước tính một lệnh mua proxy tĩnh. None = không tra được
    (loaiproxy lạ) → caller BỎ QUA việc trừ sổ thay vì đoán bừa."""
    if days < 1:
        return None
    if loaiproxy in _PACKAGE_COST_PER_30_DAYS:
        return round(_PACKAGE_COST_PER_30_DAYS[loaiproxy] * days / 30)
    ladder_name = _STATIC_LADDER_BY_LOAIPROXY.get(loaiproxy)
    if ladder_name is None:
        return None
    return _rate_from_ladder(_LADDERS[ladder_name], days) * days


def xoay_cost_xu(unit: str, thoigian: int) -> int | None:
    """Giá vốn ước tính một lệnh mua key xoay. `unit` là "day"|"week"|"month"
    — cùng đơn vị mà `_xoay_endpoint()` đã chọn."""
    if thoigian < 1:
        return None
    per_unit = _XOAY_COST_PER_UNIT.get(unit)
    if per_unit is None:
        return None
    return per_unit * thoigian

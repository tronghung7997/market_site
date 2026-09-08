from .base import PricingStrategy


def parse_plan_price_key(key) -> tuple[str, str, int] | None:
    """`type|network|days` → tuple, or None if the key is not a sellable plan."""
    parts = str(key).split("|")
    if len(parts) != 3:
        return None
    proxy_type, network, raw_days = parts
    if not proxy_type.strip() or not network.strip():
        return None
    try:
        days = int(raw_days)
    except (TypeError, ValueError):
        return None
    if days <= 0:
        return None
    return proxy_type.strip(), network.strip(), days


def plan_prices_map(params: dict) -> dict[str, int]:
    raw = params.get("plan_prices")
    if not isinstance(raw, dict) or not raw:
        return {}
    out: dict[str, int] = {}
    for key, value in raw.items():
        parsed = parse_plan_price_key(key)
        if parsed is None:
            continue
        if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
            continue
        proxy_type, network, days = parsed
        out[f"{proxy_type}|{network}|{days}"] = value
    return out


def humanize_code(code) -> str:
    """Mã máy → nhãn đọc được, dùng khi admin chưa đặt tên hiển thị.

    Mã máy là thứ gửi thẳng cho nhà cung cấp (`residential_static`,
    `GoiViettel`) nên buyer không nên phải đọc nó; trước 30/07 fallback là
    chính mã đó, nên trang mua hiện ra "residential_static" giữa giao diện
    tiếng Việt. Chỉ làm sạch dấu gạch dưới và viết hoa chữ đầu — KHÔNG dịch
    hay đoán nghĩa: đặt tên đúng theo sản phẩm vẫn là việc của admin qua
    type_display/network_display.

    Chỉ chữ CÁI ĐẦU mỗi từ được viết hoa, phần còn lại giữ nguyên: "FPT" ở
    yên là "FPT", "GoiViettel" không bị bẻ thành "Goiviettel".
    """
    text = str(code)
    words = [w for w in text.replace("_", " ").replace("-", " ").split(" ") if w]
    if not words:
        return text
    return " ".join(w[:1].upper() + w[1:] for w in words)


class ConfigPricing(PricingStrategy):
    """Config-based pricing: base_price x type_mult x network_mult x (days/30) x quantity."""

    name = "config"

    def normalize_user_config(self, params: dict, user_config: dict) -> dict:
        cfg = dict(user_config)
        prices = plan_prices_map(params)
        raw_key = cfg.get("plan_key")
        parsed = parse_plan_price_key(raw_key) if raw_key is not None and raw_key != "" else None
        if parsed is not None:
            proxy_type, network, days = parsed
            cfg["type"] = proxy_type
            cfg["network"] = network
            cfg["days"] = days
            cfg["plan_key"] = f"{proxy_type}|{network}|{days}"
        elif prices and "type" in cfg and "network" in cfg and "days" in cfg:
            cfg["plan_key"] = f"{cfg['type']}|{cfg['network']}|{cfg['days']}"
        return cfg

    def get_options(self, params: dict) -> list[dict]:
        # field_labels/type_display/network_display là lớp hiển thị tuỳ chọn —
        # key máy (gửi cho adapter/nhà cung cấp thật, xem RealApiAdapter.provision)
        # không đổi dù có hay không có các dict này. Thiếu thì fallback về đúng
        # key máy như trước, không phá sản phẩm đã cấu hình từ trước.
        field_labels = params.get("field_labels", {})
        type_display = params.get("type_display", {})
        network_display = params.get("network_display", {})

        fields: list[dict] = []
        prices = plan_prices_map(params)
        if prices:
            fields.append({
                "field": "plan_key",
                "type": "radio",
                "label": field_labels.get("plan_key", "Gói proxy"),
                "required": True,
                "choices": [
                    {
                        "value": key,
                        "label": (
                            f"{type_display.get(parsed[0]) or humanize_code(parsed[0])}"
                            f" · {network_display.get(parsed[1]) or parsed[1]}"
                            f" · {parsed[2]} ngày"
                        ),
                    }
                    for key, parsed in (
                        (k, parse_plan_price_key(k)) for k in prices
                    )
                    if parsed is not None
                ],
            })
            fields.append({
                "field": "quantity",
                "type": "number",
                "label": field_labels.get("quantity", "Số lượng"),
                "required": True,
                "min": 1,
            })
            return fields

        if "type_mult" in params:
            fields.append({
                "field": "type",
                "type": "select",
                "label": field_labels.get("type", "Loại proxy"),
                "required": True,
                "choices": [
                    {"value": k, "label": type_display.get(k) or humanize_code(k)} for k in params["type_mult"]
                ],
            })

        if "network_mult" in params:
            fields.append({
                "field": "network",
                "type": "select",
                "label": field_labels.get("network", "Nhà mạng"),
                "required": True,
                "choices": [
                    {"value": k, "label": network_display.get(k) or humanize_code(k)} for k in params["network_mult"]
                ],
            })

        if "duration_options" in params:
            fields.append({
                "field": "days",
                "type": "select",
                "label": field_labels.get("days", "Thời hạn"),
                "required": True,
                "choices": [
                    {"value": d["days"], "label": d["label"]}
                    for d in params["duration_options"]
                ],
            })

        fields.append({
            "field": "quantity",
            "type": "number",
            "label": field_labels.get("quantity", "Số lượng"),
            "required": True,
            "min": 1,
        })

        return fields

    def _subtotal(self, params: dict, user_config: dict) -> tuple[int, int]:
        cfg = self.normalize_user_config(params, user_config)
        quantity = cfg["quantity"]
        prices = plan_prices_map(params)
        if prices:
            key = f"{cfg['type']}|{cfg['network']}|{cfg['days']}"
            subtotal = prices[key] * quantity
            return subtotal, quantity
        type_mult = params["type_mult"][cfg["type"]]
        network_mult = params["network_mult"][cfg["network"]]
        days = cfg["days"]
        subtotal = round(
            params["base_price"] * type_mult * network_mult * (days / 30) * quantity
        )
        return subtotal, quantity

    def validate(self, params: dict, user_config: dict) -> bool:
        cfg = self.normalize_user_config(params, user_config)
        required = ["type", "network", "days", "quantity"]
        if not all(k in cfg for k in required):
            return False

        quantity = cfg["quantity"]
        if not isinstance(quantity, int) or quantity < 1:
            return False

        prices = plan_prices_map(params)
        if prices:
            key = f"{cfg['type']}|{cfg['network']}|{cfg['days']}"
            return key in prices

        if cfg["type"] not in params.get("type_mult", {}):
            return False
        if cfg["network"] not in params.get("network_mult", {}):
            return False

        days = cfg["days"]
        if not isinstance(days, int) or isinstance(days, bool) or days <= 0:
            return False

        # `days` PHẢI là một trong các kỳ hạn đã niêm yết, không phải số bất kỳ.
        # Giá ở đây tuyến tính theo ngày (base_price * days/30) còn giá nhập của
        # nhà cung cấp là BẬC THANG (rẻ dần theo kỳ hạn dài). Cho phép days tự
        # do nghĩa là ai gọi thẳng API với days=1 sẽ trả 1/30 giá tháng trong
        # khi mình phải mua ở đơn giá ngày đắt nhất — lỗ đều mỗi đơn, và không
        # có gì trên UI để lộ ra là đang bị khai thác. Kỳ hạn nào muốn bán thì
        # niêm yết trong duration_options với base_price đã tính đúng biên.
        duration_options = params.get("duration_options")
        if duration_options:
            allowed = {d.get("days") for d in duration_options if isinstance(d, dict)}
            if days not in allowed:
                return False

        return True

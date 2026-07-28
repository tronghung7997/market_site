from .base import PricingStrategy


class ConfigPricing(PricingStrategy):
    """Config-based pricing: base_price x type_mult x network_mult x (days/30) x quantity."""

    name = "config"

    def get_options(self, params: dict) -> list[dict]:
        # field_labels/type_display/network_display là lớp hiển thị tuỳ chọn —
        # key máy (gửi cho adapter/nhà cung cấp thật, xem RealApiAdapter.provision)
        # không đổi dù có hay không có các dict này. Thiếu thì fallback về đúng
        # key máy như trước, không phá sản phẩm đã cấu hình từ trước.
        field_labels = params.get("field_labels", {})
        type_display = params.get("type_display", {})
        network_display = params.get("network_display", {})

        fields: list[dict] = []

        if "type_mult" in params:
            fields.append({
                "field": "type",
                "type": "select",
                "label": field_labels.get("type", "Loại proxy"),
                "required": True,
                "choices": [
                    {"value": k, "label": type_display.get(k, k)} for k in params["type_mult"]
                ],
            })

        if "network_mult" in params:
            fields.append({
                "field": "network",
                "type": "select",
                "label": field_labels.get("network", "Nhà mạng"),
                "required": True,
                "choices": [
                    {"value": k, "label": network_display.get(k, k)} for k in params["network_mult"]
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
        quantity = user_config["quantity"]
        type_mult = params["type_mult"][user_config["type"]]
        network_mult = params["network_mult"][user_config["network"]]
        days = user_config["days"]
        subtotal = round(
            params["base_price"] * type_mult * network_mult * (days / 30) * quantity
        )
        return subtotal, quantity

    def validate(self, params: dict, user_config: dict) -> bool:
        required = ["type", "network", "days", "quantity"]
        if not all(k in user_config for k in required):
            return False

        quantity = user_config["quantity"]
        if not isinstance(quantity, int) or quantity < 1:
            return False

        if user_config["type"] not in params.get("type_mult", {}):
            return False
        if user_config["network"] not in params.get("network_mult", {}):
            return False

        days = user_config["days"]
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

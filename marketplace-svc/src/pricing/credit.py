from .base import PricingStrategy


class CreditPricing(PricingStrategy):
    """Credit-based pricing: credit_price x package_size (quantity hiệu dụng = package_size)."""

    name = "credit"

    def get_options(self, params: dict) -> list[dict]:
        fields: list[dict] = []

        # Nhãn buyer đọc — trước 30/07 là "Package size", hiện lên UI thành
        # "PACKAGE SIZE" giữa một trang tiếng Việt. field_labels cho phép admin
        # đặt tên riêng theo sản phẩm (vd "Số lượt gọi API").
        field_labels = params.get("field_labels", {})
        size_label = field_labels.get("package_size", "Số request trong gói")

        packages = params.get("packages", [])
        if packages:
            fields.append({
                "field": "package_size",
                "type": "select",
                "label": size_label,
                "required": True,
                "choices": [
                    {"value": p["size"], "label": p.get("label", f"{p['size']} credits")}
                    for p in packages
                ],
            })
        else:
            fields.append({
                "field": "package_size",
                "type": "number",
                "label": size_label,
                "required": True,
                "min": 1,
            })

        return fields

    def _subtotal(self, params: dict, user_config: dict) -> tuple[int, int]:
        package_size = user_config["package_size"]
        return round(params["credit_price"] * package_size), package_size

    def validate(self, params: dict, user_config: dict) -> bool:
        if "package_size" not in user_config:
            return False
        package_size = user_config["package_size"]
        if not isinstance(package_size, int) or package_size < 1:
            return False
        return True

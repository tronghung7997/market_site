from .base import PricingStrategy


class CreditPricing(PricingStrategy):
    """Credit-based pricing: credit_price x package_size (quantity hiệu dụng = package_size).

    Gói có `price` riêng (admin đặt ở tab Gói bán của nguồn API, xem
    suppliers/gateway_sources.py) thì bán đúng giá đó thay vì credit_price ×
    size, và buyer chỉ chọn được các gói đó (gói `active: false` bị ẩn)."""

    name = "credit"

    @staticmethod
    def _priced_packages(params: dict) -> list[dict]:
        return [
            p for p in params.get("packages", [])
            if p.get("price") is not None and p.get("active", True)
        ]

    def get_options(self, params: dict) -> list[dict]:
        fields: list[dict] = []

        # Nhãn buyer đọc — trước 30/07 là "Package size", hiện lên UI thành
        # "PACKAGE SIZE" giữa một trang tiếng Việt. field_labels cho phép admin
        # đặt tên riêng theo sản phẩm (vd "Số lượt gọi API").
        field_labels = params.get("field_labels", {})
        size_label = field_labels.get("package_size", "Số request trong gói")

        priced = self._priced_packages(params)
        packages = priced or [p for p in params.get("packages", []) if p.get("active", True)]
        if packages:
            choices = []
            for p in packages:
                choice = {"value": p["size"], "label": p.get("label", f"{p['size']} credits")}
                if p.get("price") is not None:
                    choice["price"] = int(p["price"])
                    choice["per_unit"] = round(int(p["price"]) / max(int(p["size"]), 1), 2)
                choices.append(choice)
            fields.append({
                "field": "package_size",
                "type": "select",
                "label": size_label,
                "required": True,
                "choices": choices,
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
        for p in self._priced_packages(params):
            if int(p["size"]) == package_size:
                return int(p["price"]), package_size
        return round(params["credit_price"] * package_size), package_size

    def validate(self, params: dict, user_config: dict) -> bool:
        if "package_size" not in user_config:
            return False
        package_size = user_config["package_size"]
        if not isinstance(package_size, int) or package_size < 1:
            return False
        priced = self._priced_packages(params)
        if priced and package_size not in {int(p["size"]) for p in priced}:
            return False
        return True

    def normalize_user_config(self, params: dict, user_config: dict) -> dict:
        """Return a copy of user_config ready to validate, quote, and persist."""
        return dict(user_config)

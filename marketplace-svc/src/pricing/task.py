from .base import PricingStrategy


class TaskPricing(PricingStrategy):
    """Task-based pricing: base_price x platform_mult x số URL trong target_urls.

    Quantity luôn được đếm từ target_urls — không nhận từ user để giá và
    số task tạo ra không bao giờ lệch nhau.
    """

    name = "task"

    @staticmethod
    def parse_target_urls(raw: str) -> list[str]:
        return [u.strip() for u in (raw or "").strip().split("\n") if u.strip()]

    def get_options(self, params: dict) -> list[dict]:
        # Cùng cơ chế field_labels/platform_display với ConfigPricing — key máy
        # gửi cho adapter không đổi, chỉ thêm lớp nhãn hiển thị tuỳ chọn.
        field_labels = params.get("field_labels", {})
        platform_display = params.get("platform_display", {})

        fields: list[dict] = []

        if "platform_mult" in params:
            fields.append({
                "field": "platform",
                "type": "select",
                "label": field_labels.get("platform", "Nền tảng"),
                "required": True,
                "choices": [
                    {"value": k, "label": platform_display.get(k, k)} for k in params["platform_mult"]
                ],
            })

        fields.append({
            "field": "target_urls",
            "type": "textarea",
            "label": field_labels.get("target_urls", "Danh sách URL"),
            "required": True,
            "help": "Mỗi dòng một URL — giá tính theo số URL",
        })

        return fields

    def _subtotal(self, params: dict, user_config: dict) -> tuple[int, int]:
        urls = self.parse_target_urls(user_config.get("target_urls", ""))
        quantity = len(urls)
        platform_mult = params["platform_mult"][user_config["platform"]]
        return round(params["base_price"] * platform_mult * quantity), quantity

    def validate(self, params: dict, user_config: dict) -> bool:
        if user_config.get("platform") not in params.get("platform_mult", {}):
            return False
        return len(self.parse_target_urls(user_config.get("target_urls", ""))) >= 1

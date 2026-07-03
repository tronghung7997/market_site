from .base import PricingStrategy


class FixedPricing(PricingStrategy):
    """Fixed pricing: variant_price x quantity."""

    name = "fixed"

    def get_options(self, params: dict) -> list[dict]:
        variants = params.get("variants", [])
        return [
            {
                "field": "variant_id",
                "type": "select",
                "label": "Variant",
                "required": True,
                "choices": [
                    {"value": v["id"], "label": v["label"], "price": v["price"]}
                    for v in variants
                ],
            },
            {
                "field": "quantity",
                "type": "number",
                "label": "Quantity",
                "required": True,
                "min": 1,
            },
        ]

    def _subtotal(self, params: dict, user_config: dict) -> tuple[int, int]:
        quantity = user_config["quantity"]
        variants = {v["id"]: v for v in params.get("variants", [])}
        variant = variants[user_config["variant_id"]]
        return round(variant["price"] * quantity), quantity

    def validate(self, params: dict, user_config: dict) -> bool:
        if "variant_id" not in user_config or "quantity" not in user_config:
            return False
        quantity = user_config["quantity"]
        if not isinstance(quantity, int) or quantity < 1:
            return False
        variant_ids = {v["id"] for v in params.get("variants", [])}
        return user_config["variant_id"] in variant_ids

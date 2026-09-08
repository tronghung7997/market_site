from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass
class Quote:
    """Kết quả tính giá cuối cùng — nguồn sự thật duy nhất cho mọi caller."""

    amount: int
    original_amount: int | None
    discount_pct: float | None
    quantity: int
    strategy: str


class PricingStrategy(ABC):
    """Abstract base class for all pricing strategies.

    Subclasses implement get_options/validate/_subtotal. quote() is the only
    money API: it applies volume discount exactly once — callers must never
    re-multiply by quantity or re-apply discounts.
    """

    name: str = ""

    @abstractmethod
    def get_options(self, params: dict) -> list[dict]:
        """Return form field definitions for the frontend."""
        ...

    @abstractmethod
    def validate(self, params: dict, user_config: dict) -> bool:
        """Validate that user_config is valid given the provider params."""
        ...

    @abstractmethod
    def _subtotal(self, params: dict, user_config: dict) -> tuple[int, int]:
        """Return (pre-discount amount in VND, effective quantity)."""
        ...

    def normalize_user_config(self, params: dict, user_config: dict) -> dict:
        """Return a copy of user_config ready to validate, quote, and persist."""
        return dict(user_config)

    def quote(self, params: dict, user_config: dict) -> Quote:
        subtotal, quantity = self._subtotal(params, user_config)
        tiers = params.get("volume_tiers", [])
        if tiers:
            amount, discount = self.apply_volume_discount(subtotal, quantity, tiers)
        else:
            amount, discount = subtotal, None
        return Quote(
            amount=amount,
            original_amount=subtotal if discount is not None else None,
            discount_pct=discount,
            quantity=quantity,
            strategy=self.name,
        )

    def apply_volume_discount(
        self, amount: int, quantity: int, tiers: list[dict]
    ) -> tuple[int, float | None]:
        """Apply volume discount based on quantity tiers.

        Args:
            amount: Pre-discount total price in VND.
            quantity: Number of items purchased.
            tiers: List of {"min_qty": int, "discount": float} dicts,
                   e.g. [{"min_qty": 10, "discount": 0.05}].

        Returns:
            (discounted_amount, discount_pct) or (amount, None) if no tier matches.
        """
        applicable = [t for t in tiers if quantity >= t["min_qty"]]
        if not applicable:
            return amount, None
        best = max(applicable, key=lambda t: t["min_qty"])
        discount = best["discount"]
        return round(amount * (1 - discount)), discount

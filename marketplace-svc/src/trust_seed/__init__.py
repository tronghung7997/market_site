"""Admin-authored demo reviews for cold-start social proof.

Everything it writes carries ``is_seeded`` and belongs to a batch, so seeded
volume stays out of financial reporting and can be reversed in one call.
"""

from src.trust_seed.router import router as trust_seed_router

__all__ = ["trust_seed_router"]

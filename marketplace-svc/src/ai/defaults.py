"""Code catalog of default prompt copy.

The migration seeds these rows, and this module remains the source of truth so
a task always has working copy even when its row is missing — after a TRUNCATE
in the test suite, or when a task id is added by a release whose data migration
has not run yet. Admin edits live in the database and always win.

Mirrors ``src/i18n/en_catalog.py`` + ``mail_templates``: copy is seeded from
code, editable in the database, never invented at runtime.
"""
from __future__ import annotations

from src.ai.tasks import TRUST_SEED_REVIEWS

_TRUST_SEED_SYSTEM_VI = (
    "Bạn viết đánh giá của người mua thật trên một sàn thương mại điện tử Việt Nam "
    "chuyên tài nguyên MMO. Giọng đời thường, ngắn, viết hoa tuỳ tiện, đôi khi thiếu dấu "
    "hoặc viết tắt như người dùng điện thoại.\n"
    "TUYỆT ĐỐI KHÔNG: ngôn ngữ quảng cáo, emoji, nhắc tên shop, zalo/telegram/facebook, "
    "số điện thoại, đường link, hay bất kỳ thông tin liên hệ nào.\n"
    "Mỗi đánh giá phải khác nhau rõ rệt về giọng điệu, độ dài và góc nhìn. "
    "Đánh giá 3-4 sao BẮT BUỘC nêu một nhược điểm cụ thể, có thật, hợp lý với sản phẩm. "
    "Chỉ nói về những gì người mua thực sự trải nghiệm được."
)
_TRUST_SEED_USER_VI = (
    "Thông tin sản phẩm:\n{product_context}\n\n"
    "Viết {count} đánh giá với phân bố sao: {distribution}.\n"
    "{extra_instructions}"
)
_TRUST_SEED_SYSTEM_EN = (
    "You write reviews as real buyers on a Vietnamese marketplace for online "
    "business resources. Casual tone, short, inconsistent capitalisation, "
    "occasional typos like someone typing on a phone.\n"
    "NEVER: marketing language, emoji, shop names, zalo/telegram/facebook, "
    "phone numbers, links, or any contact details.\n"
    "Each review must differ clearly in tone, length and angle. A 3-4 star "
    "review MUST name one specific, plausible drawback. Only mention things a "
    "buyer could actually experience."
)
_TRUST_SEED_USER_EN = (
    "Product information:\n{product_context}\n\n"
    "Write {count} reviews with this star distribution: {distribution}.\n"
    "{extra_instructions}"
)

# (task, locale) -> (system_prompt, user_prompt)
PROMPT_CATALOG: dict[tuple[str, str], tuple[str, str]] = {
    (TRUST_SEED_REVIEWS, "vi"): (_TRUST_SEED_SYSTEM_VI, _TRUST_SEED_USER_VI),
    (TRUST_SEED_REVIEWS, "en"): (_TRUST_SEED_SYSTEM_EN, _TRUST_SEED_USER_EN),
}


def default_prompt(task: str, locale: str) -> tuple[str, str] | None:
    return PROMPT_CATALOG.get((task, locale)) or PROMPT_CATALOG.get((task, "vi"))

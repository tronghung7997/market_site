"""Unit coverage for the public identifier helpers and the review masking."""
import pytest

from src.i18n.slug import canonical_path, is_public_key, new_public_key, parse_public_ref, slugify_text
from src.reviews.schemas import ReviewResponse
from src.reviews.service import mask_reviewer

pytestmark = pytest.mark.no_db


@pytest.mark.parametrize(
    ("title", "expected"),
    [
        ("Proxy dân cư — Trust cao, Anti Detect mạnh", "proxy-dan-cu-trust-cao-anti-detect-manh"),
        ("Đăng ký Telegram số ảo / Session + JSON", "dang-ky-telegram-so-ao-session-json"),
        ("  Rotating IPv4 Proxy Key (Weekly)  ", "rotating-ipv4-proxy-key-weekly"),
        ("!!!", "product"),
        (None, "product"),
    ],
)
def test_slugify_text(title, expected):
    assert slugify_text(title) == expected


def test_slugify_text_caps_length():
    assert len(slugify_text("a" * 500)) == 140


def test_public_key_is_base36_with_a_letter():
    for _ in range(200):
        key = new_public_key()
        assert is_public_key(key)
        assert not key.isdigit()


def test_parse_public_ref_forms():
    key = "k7f3q9x2"
    assert parse_public_ref("123") == ("id", 123)
    assert parse_public_ref(key) == ("key", key)
    assert parse_public_ref(f"some-slug-{key}") == ("key", key)
    assert parse_public_ref(f"Some-Slug-{key.upper()}") == ("key", key)
    assert parse_public_ref("just-a-slug") is None
    assert parse_public_ref("") is None
    # Eight digits is a legacy id, never a key.
    assert parse_public_ref("12345678") == ("id", 12345678)


def test_canonical_path():
    assert canonical_path("/products", "a-b", "k7f3q9x2") == "/products/a-b-k7f3q9x2"
    assert canonical_path("/products/", None, "k7f3q9x2") == "/products/k7f3q9x2"


def test_mask_reviewer_never_reveals_ids_or_full_email():
    assert mask_reviewer("nguyenvan@example.com") == "ng***n"
    assert mask_reviewer("ab@example.com") == "***"
    assert mask_reviewer(None) == "***"


def test_review_response_has_no_sequential_ids():
    assert "buyer_id" not in ReviewResponse.model_fields
    assert "order_id" not in ReviewResponse.model_fields
    assert "reviewer_label" in ReviewResponse.model_fields

import json
from typing import Any


MAX_JSON_KEYS = 64
MAX_JSON_BYTES = 16_384


def bounded_mapping(
    value: Any,
    *,
    max_keys: int = MAX_JSON_KEYS,
    max_bytes: int = MAX_JSON_BYTES,
) -> dict:
    if value is None:
        return value
    if not isinstance(value, dict):
        raise ValueError("Must be an object")
    if len(value) > max_keys:
        raise ValueError(f"At most {max_keys} keys")
    raw = json.dumps(value, default=str, separators=(",", ":"))
    if len(raw.encode("utf-8")) > max_bytes:
        raise ValueError("Object exceeds size limit")
    return value

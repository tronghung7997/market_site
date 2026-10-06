"""Order-list date filters read as the viewer's calendar days.

A buyer or seller who picks "06/10" means 00:00–24:00 of that day where they
are, not in UTC: for Vietnam (UTC+7) the UTC reading moved every order placed
before 07:00 to the previous day. Dates come as ``YYYY-MM-DD``; a value that
already carries a time and offset is taken as-is."""

from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

DEFAULT_ORDER_TZ = "Asia/Ho_Chi_Minh"


def order_tz(name: str | None) -> ZoneInfo:
    """The viewer's IANA zone; unknown or missing falls back to Vietnam."""
    try:
        return ZoneInfo((name or DEFAULT_ORDER_TZ).strip())
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo(DEFAULT_ORDER_TZ)


def _parse(raw: str, tz: ZoneInfo) -> tuple[datetime, bool] | None:
    """``(start, is_whole_day)``; None when the value is not a date."""
    raw = raw.strip()
    try:
        return datetime.combine(date.fromisoformat(raw), time.min, tzinfo=tz), True
    except ValueError:
        pass
    try:
        parsed = datetime.fromisoformat(raw)
    except ValueError:
        return None
    return (parsed if parsed.tzinfo else parsed.replace(tzinfo=tz)), False


def created_at_bounds(date_from: str | None, date_to: str | None, tz_name: str | None = None) -> tuple[datetime | None, datetime | None]:
    """``(lower inclusive, upper exclusive)`` for ``Order.created_at``. A
    whole-day ``date_to`` includes that entire day; malformed values are
    ignored, as before."""
    tz = order_tz(tz_name)
    lower = upper = None
    if date_from:
        parsed = _parse(date_from, tz)
        if parsed:
            lower = parsed[0]
    if date_to:
        parsed = _parse(date_to, tz)
        if parsed:
            start, whole_day = parsed
            upper = start + timedelta(days=1) if whole_day else start
    return lower, upper

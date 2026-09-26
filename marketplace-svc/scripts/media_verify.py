"""CLI: kiểm tra mọi ảnh còn đủ bytes ở nơi row của nó ghi (Postgres hoặc S3/R2).

Mặc định so kích thước (HEAD với S3, rẻ). --hash tải về và so sha256 (chậm hơn,
tốn lượt đọc). Thoát mã 1 nếu có ảnh thiếu hoặc sai — dùng được trong cron /
sau khi đổi nhà cung cấp (rclone sync).

Usage:

  docker compose exec marketplace-svc python scripts/media_verify.py
  docker compose exec marketplace-svc python scripts/media_verify.py --hash
"""
from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.media.transfer import verify_objects  # noqa: E402

MAX_LISTED = 50


async def _run(*, check_hash: bool) -> int:
    report = await verify_objects(check_hash=check_hash)
    print(f"Đã kiểm: {report.checked} ảnh")
    for title, items in (("Thiếu", report.missing), ("Sai nội dung", report.corrupt)):
        if items:
            print(f"{title}: {len(items)}")
            for line in items[:MAX_LISTED]:
                print(f"  {line}")
            if len(items) > MAX_LISTED:
                print(f"  … và {len(items) - MAX_LISTED} ảnh khác")
    print("OK" if report.ok else "CÓ LỖI")
    return 0 if report.ok else 1


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--hash", action="store_true", help="Tải về và so sha256 (mặc định chỉ so kích thước)")
    args = parser.parse_args()
    raise SystemExit(asyncio.run(_run(check_hash=args.hash)))


if __name__ == "__main__":
    main()

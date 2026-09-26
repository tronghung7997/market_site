"""CLI: chuyển ảnh giữa Postgres và S3/R2/MinIO (xem docs/media-storage.md).

Mặc định DRY-RUN (chỉ đếm). Thêm --apply mới chuyển. Mỗi ảnh chuyển trong một
transaction ngắn và được so sha256 với lúc upload, nên có thể dừng giữa chừng
rồi chạy lại: ảnh đã chuyển sẽ được bỏ qua.

Cần MEDIA_S3_* trong env (dù chuyển chiều nào). Không in ra key hay secret.

Usage:

  # Đếm ảnh còn nằm trong Postgres
  docker compose exec marketplace-svc python scripts/media_migrate.py --to s3

  # Chuyển hết sang S3/R2 (sau khi đã đặt MEDIA_STORAGE=s3)
  docker compose exec marketplace-svc python scripts/media_migrate.py --to s3 --apply

  # Rollback: kéo ảnh từ S3 về lại Postgres
  docker compose exec marketplace-svc python scripts/media_migrate.py --to db --apply
"""
from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.media.store import StorageUnavailable  # noqa: E402
from src.media.transfer import migrate_objects  # noqa: E402


async def _run(*, target: str, apply: bool, limit: int | None) -> int:
    try:
        report = await migrate_objects(target=target, apply=apply, limit=limit)
    except StorageUnavailable as exc:
        print(f"Không chạy được: {exc}")
        return 2
    print(f"Ảnh chưa nằm ở '{target}': {report.pending}")
    if report.dry_run:
        print("DRY-RUN — thêm --apply để chuyển.")
        return 0
    print(f"Đã chuyển: {report.moved} ảnh, {report.bytes_moved / 1_048_576:.1f} MB")
    if report.failed:
        print(f"Lỗi ({len(report.failed)}):")
        for line in report.failed:
            print(f"  {line}")
        return 1
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--to", dest="target", choices=("s3", "db"), required=True, help="Nơi lưu đích")
    parser.add_argument("--apply", action="store_true", help="Chuyển thật (mặc định dry-run)")
    parser.add_argument("--limit", type=int, default=None, help="Chỉ chuyển tối đa N ảnh (chạy thử)")
    args = parser.parse_args()
    raise SystemExit(asyncio.run(_run(target=args.target, apply=args.apply, limit=args.limit)))


if __name__ == "__main__":
    main()

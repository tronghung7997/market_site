"""CLI: import blog posts written as markdown files as DRAFTS (backlog F39).

Reads ``docs/content/blog-drafts/<slug>.vi.md`` (required) and
``<slug>.en.md`` (optional). Each file starts with a ``---`` block of
``key: value`` lines — vi: slug, category, tags (comma separated), title,
excerpt, meta_title, meta_description; en: the same copy keys — followed by the
markdown body. Everything is validated with the admin API schema
(posts.schemas.PostWrite) before the database is touched.

Posts are created with status ``draft``: an admin reviews and publishes (or
schedules) them in /admin/posts. A slug that already exists is skipped;
``--overwrite`` replaces its copy only while it is still a draft — a published
post is never touched.

Default is a DRY-RUN that prints the plan and rolls back; add --apply to commit.

    uv run python scripts/import_blog_drafts.py
    uv run python scripts/import_blog_drafts.py --actor 18 --apply
"""
from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # noqa: E402 — run as a plain script

from sqlalchemy import select  # noqa: E402

from src.database import SessionLocal  # noqa: E402
from src.models.account import Account  # noqa: E402
from src.models.post import Post  # noqa: E402
from src.posts.schemas import PostWrite  # noqa: E402

DEFAULT_DIR = Path(__file__).resolve().parents[2] / "docs" / "content" / "blog-drafts"
COPY_KEYS = ("title", "excerpt", "meta_title", "meta_description")


def parse(path: Path) -> tuple[dict[str, str], str]:
    text = path.read_text(encoding="utf-8")
    if not text.startswith("---\n"):
        raise ValueError(f"{path.name}: missing front matter")
    head, _, body = text[4:].partition("\n---\n")
    meta: dict[str, str] = {}
    for line in head.splitlines():
        if line.strip():
            key, sep, value = line.partition(":")
            if not sep:
                raise ValueError(f"{path.name}: bad front matter line {line!r}")
            meta[key.strip()] = value.strip()
    return meta, body.strip() + "\n"


def load(folder: Path) -> list[PostWrite]:
    posts: list[PostWrite] = []
    for vi_path in sorted(folder.glob("*.vi.md")):
        vi_meta, vi_body = parse(vi_path)
        en_path = vi_path.with_name(vi_path.name.replace(".vi.md", ".en.md"))
        en_meta, en_body = parse(en_path) if en_path.exists() else ({}, "")
        posts.append(PostWrite(
            slug=vi_meta["slug"],
            category=vi_meta.get("category", "guide"),
            vi={**{key: vi_meta.get(key, "") for key in COPY_KEYS}, "body": vi_body},
            en={**{key: en_meta.get(key, "") for key in COPY_KEYS}, "body": en_body},
            tags=[tag for tag in vi_meta.get("tags", "").split(",")],
            publish=False,
        ))
    return posts


async def _run(*, folder: Path, apply: bool, overwrite: bool, actor: int | None) -> int:
    posts = load(folder)
    if not posts:
        print(f"no *.vi.md files in {folder}")
        return 1
    async with SessionLocal() as db:
        if actor is not None:
            admin = await db.get(Account, actor)
            if admin is None or "admin" not in {getattr(r, "value", r) for r in (admin.roles or [])}:
                print(f"refusing: account {actor} is not an admin")
                return 1
        for post in posts:
            i18n = {"vi": post.vi.model_dump(), "en": post.en.model_dump()}
            existing = await db.scalar(select(Post).where(Post.slug == post.slug))
            if existing is None:
                db.add(Post(
                    slug=post.slug, category=post.category, status="draft", published_at=None,
                    i18n=i18n, tags=post.tags, author_id=actor,
                ))
                print(f"  + draft /blog/{post.slug} ({len(post.vi.body)} chars vi, {len(post.en.body)} chars en, tags {post.tags})")
            elif overwrite and existing.status == "draft":
                existing.category, existing.i18n, existing.tags = post.category, i18n, post.tags
                print(f"  ~ draft /blog/{post.slug} replaced")
            else:
                print(f"  = /blog/{post.slug} exists ({existing.status}), left as is")
        if apply:
            await db.commit()
            print("APPLIED")
        else:
            await db.rollback()
            print("DRY-RUN — rolled back. Add --apply to commit.")
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dir", type=Path, default=DEFAULT_DIR, help="folder with <slug>.vi.md / <slug>.en.md")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--overwrite", action="store_true", help="replace a post with the same slug while it is a draft")
    parser.add_argument("--actor", type=int, default=None, help="admin account id saved as the author")
    args = parser.parse_args()
    sys.exit(asyncio.run(_run(folder=args.dir, apply=args.apply, overwrite=args.overwrite, actor=args.actor)))


if __name__ == "__main__":
    main()

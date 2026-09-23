"""Container boot runs `alembic upgrade head` (Dockerfile CMD). Parallel
branches pick revision ids by hand, so a second head only shows up there —
catch it in CI instead."""
from pathlib import Path

import pytest
from alembic.config import Config
from alembic.script import ScriptDirectory


@pytest.mark.no_db
def test_migrations_have_a_single_head():
    root = Path(__file__).resolve().parents[1]
    config = Config(str(root / "alembic.ini"))
    config.set_main_option("script_location", str(root / "alembic"))
    heads = ScriptDirectory.from_config(config).get_heads()
    assert len(heads) == 1, f"multiple alembic heads: {heads}"

"""Downgrade of signed-credentials migration must refuse to drop live keys."""

import importlib.util
from pathlib import Path
from unittest.mock import MagicMock

import pytest

_REV_PATH = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "cl1a2b3c4d5e6_signed_api_credentials.py"
)


def _load_revision():
    spec = importlib.util.spec_from_file_location("signed_api_credentials_rev", _REV_PATH)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.mark.no_db
def test_downgrade_raises_when_signed_only_rows_exist(monkeypatch):
    rev = _load_revision()
    fake_conn = MagicMock()
    fake_conn.execute.return_value.scalar.return_value = 3
    monkeypatch.setattr(rev.op, "get_bind", lambda: fake_conn)
    drop_index = MagicMock()
    drop_column = MagicMock()
    monkeypatch.setattr(rev.op, "drop_index", drop_index)
    monkeypatch.setattr(rev.op, "drop_column", drop_column)

    with pytest.raises(RuntimeError, match="signed-only"):
        rev.downgrade()

    drop_index.assert_not_called()
    drop_column.assert_not_called()


@pytest.mark.no_db
def test_downgrade_proceeds_when_no_signed_only_rows(monkeypatch):
    rev = _load_revision()
    fake_conn = MagicMock()
    fake_conn.execute.return_value.scalar.return_value = 0
    monkeypatch.setattr(rev.op, "get_bind", lambda: fake_conn)
    drop_index = MagicMock()
    drop_column = MagicMock()
    alter_column = MagicMock()
    monkeypatch.setattr(rev.op, "drop_index", drop_index)
    monkeypatch.setattr(rev.op, "drop_column", drop_column)
    monkeypatch.setattr(rev.op, "alter_column", alter_column)

    rev.downgrade()
    drop_index.assert_called_once()
    assert drop_column.call_count == 3
    alter_column.assert_called_once()

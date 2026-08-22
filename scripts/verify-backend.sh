#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE_DIR="$ROOT_DIR/marketplace-svc"
LOCK_DIR="${TMPDIR:-/tmp}/proxora-marketplace-pytest.lock"

if ! command -v uv >/dev/null 2>&1; then
  echo "error: uv is required (https://docs.astral.sh/uv/)." >&2
  exit 1
fi

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "error: another Proxora backend verification appears to be running." >&2
  echo "The test suite shares marketplace_test and must never run concurrently." >&2
  echo "If no pytest process is running, remove the stale lock: $LOCK_DIR" >&2
  exit 1
fi
trap 'rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT INT TERM

cd "$SERVICE_DIR"

echo "==> Syncing backend development dependencies"
uv sync --extra dev

echo "==> Backend architecture guard"
uv run python scripts/check_architecture.py

export TEST_DATABASE_URL="${TEST_DATABASE_URL:-postgresql+asyncpg://marketplace:marketplace@localhost:5432/marketplace_test}"
export DATABASE_URL="$TEST_DATABASE_URL"
export DEPLOYMENT_ENVIRONMENT=test
export AUTH_RATE_LIMIT_ENABLED=false
export JWT_SECRET="test-harness-jwt-secret-at-least-32-bytes"
export INTERNAL_API_KEY="test-harness-internal-key-at-least-32-bytes"
export ENCRYPTION_KEY="test-harness-encryption-key-at-least-32-bytes"
export PRINCIPAL_HMAC_SECRET="test-harness-principal-key-at-least-32-bytes"

echo "==> Migrating dedicated test database"
if ! uv run alembic upgrade head; then
  echo "error: could not migrate marketplace_test." >&2
  echo "Start docker-compose.dev.yml and create marketplace_test once if this is an old volume; see README.md." >&2
  exit 1
fi

echo "==> Running backend tests (serial process)"
uv run pytest -q "$@"

#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR/frontend"

if ! command -v npm >/dev/null 2>&1; then
  echo "error: npm is required (Node.js 20.9+)." >&2
  exit 1
fi

if [[ ! -d node_modules ]]; then
  echo "==> Installing frontend dependencies with npm ci"
  npm ci
fi

echo "==> Frontend design and module-boundary guards"
npm run check:harness

echo "==> Frontend typecheck"
npm run lint

echo "==> Frontend i18n catalog check"
npm run check:i18n

echo "==> Frontend auth/BFF route test"
npm run test:auth-route

if [[ "${SKIP_FRONTEND_BUILD:-0}" == "1" ]]; then
  echo "==> Skipping frontend production build (SKIP_FRONTEND_BUILD=1)"
else
  # Next's production config intentionally rejects localhost. The default below
  # is the Docker-network upstream and is used only to verify compilation.
  BUILD_API_URL="${API_URL:-http://marketplace-svc:8001}"
  echo "==> Frontend production build (API_URL=$BUILD_API_URL)"
  API_URL="$BUILD_API_URL" npm run build
fi

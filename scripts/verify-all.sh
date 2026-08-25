#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> Full frontend gate including production compile"
RUN_FRONTEND_BUILD=1 "$ROOT_DIR/scripts/verify-frontend.sh"
echo "==> Full backend gate"
"$ROOT_DIR/scripts/verify-backend.sh" "$@"

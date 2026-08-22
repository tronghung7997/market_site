# Proxora backend instructions

These rules extend the repository-root `AGENTS.md` for `marketplace-svc/`.

## Runtime and structure

- Read `ARCHITECTURE.md` before changing feature interfaces, cross-feature orchestration, transaction ownership, adapters, or dependency direction.
- The service uses Python 3.13+, FastAPI, Pydantic v2, async SQLAlchemy/asyncpg, Alembic, APScheduler, PostgreSQL, and Redis.
- Run backend commands from `marketplace-svc/`; `src.config.Settings` loads `.env` relative to the working directory.
- Keep route handlers thin. Put domain behavior in the existing feature service/module and persistence constraints in models/migrations.
- Prefer a deep existing service interface over new pass-through repository/use-case layers. Add a port only at a real seam with production and test adapters.
- Use `AsyncSession` and async I/O end to end. Do not add synchronous database or HTTP calls to request paths.
- Never update `scripts/architecture-baseline.json` for ordinary feature work. Baseline growth requires an explicit reviewed architecture decision and matching contract change.

## Configuration and secrets

- `JWT_SECRET`, `INTERNAL_API_KEY`, and `ENCRYPTION_KEY` are required and must be distinct, environment-provided values of at least 32 bytes.
- Never read or copy local `.env`, `.env.production*`, `backend.env`, credential backups, provider credentials, webhook secrets, or payment keys into code, tests, logs, fixtures, or documentation.
- Tests may use obviously fake values set in `tests/conftest.py` or the verification script.
- Preserve production validation in `src/config.py`; do not add insecure fallback secrets.

## Domain and security

- Enforce authorization in backend services/routes, not only in the frontend. Prefer a non-enumerating `404` where the existing feature intentionally hides resource existence.
- Treat wallet transactions, deposits, escrow, affiliate payouts, usage records, and related ledgers as financial records. Preserve idempotency, integer money semantics, locking, and auditability.
- External provider calls need explicit timeouts, bounded/recoverable failure handling, and tests for provider errors. Never mark an unverified external operation successful.
- Preserve request signing, admin access, webhook verification, encryption, rate limiting, and audit behavior unless the task explicitly changes the security contract and adds tests.
- For chat changes, read the root `CONTEXT.md`. Do not implement prototype-only support/moderation behavior by inference.

## Models and migrations

- Every persistent schema, enum, index, constraint, or data-shape change requires an Alembic revision under `alembic/versions/`.
- Import new model modules through `src/models/__init__.py` so Alembic metadata sees them.
- Prefer database constraints for uniqueness and integrity, plus service-layer validation for useful API errors.
- Validate migrations against the dedicated test database with `alembic upgrade head`. Review generated migrations manually; do not accept unrelated drops or type changes.
- Do not rewrite or delete an applied migration unless the user explicitly confirms that no shared environment has applied it.

## Tests

- Tests use `marketplace_test`, not the development database. `tests/conftest.py` forces `DATABASE_URL` to `TEST_DATABASE_URL` and truncates all application tables before each database test.
- Never run two pytest processes in parallel. Do not use `pytest-xdist`; separate agents/worktrees still share the same default test database.
- Mark a test `no_db` only when it truly does not touch application persistence.
- Cover success, validation failure, authentication failure, authorization failure, idempotent retry, and concurrency behavior when relevant.
- Prefer a targeted test file during iteration, then use the full gate before handoff.

Fast architecture check from `marketplace-svc/`:

```bash
uv run python scripts/check_architecture.py
```

The full verification script runs this guard automatically. From the repository root:

```bash
./scripts/verify-backend.sh tests/test_chat_inquiries.py
./scripts/verify-backend.sh
```

The script acquires a machine-wide pytest lock, migrates the test database, and runs pytest. A clean PostgreSQL volume creates `marketplace_test` through `init-db.sql`; for an older volume, create that database once as documented in `README.md`.

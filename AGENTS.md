# Proxora repository instructions

## Scope and precedence

- This file applies to the whole repository. A nested `AGENTS.md` adds more specific rules for its directory.
- Resolve conflicting information in this order: executable code/configuration, tests and migrations, CI/verification scripts, then documentation.
- Do not rely on framework behavior from memory when the installed version or local documentation can be inspected.

## Before changing code

1. Run `git status --short` and preserve unrelated or pre-existing changes.
2. Read `README.md`, the nearest `AGENTS.md`, and the files that execute the behavior being changed.
3. Read `DESIGN.md` before changing frontend visuals, layout, interaction patterns, shared UI, or user-facing copy. It is the locked target even while legacy migration is in progress.
4. Read the nearest `ARCHITECTURE.md` before changing module interfaces, dependency direction, transaction ownership, shared abstractions, or imports across features.
5. Read `CONTEXT.md` before changing chat. It describes only the currently implemented chat contract and explicitly marks non-implemented concepts.
6. Find the existing tests for the behavior. Prefer extending an existing pattern over adding a parallel abstraction.

## Safety boundaries

- Never read, print, edit, copy, or commit real values from `.env*`, deployment backups, credentials, API keys, tokens, or the local `pgdata/` directory.
- `.env.example` files may be updated only with placeholders and safe defaults.
- Do not modify production deployment configuration, run a deployment, commit, push, reset, clean, or discard user changes unless the user explicitly requests it.
- Do not weaken authentication, authorization, CSRF, rate limiting, encryption, request signing, audit, payment, escrow, or ledger behavior to make a test pass.
- Do not silently change API contracts, database constraints, money units, role semantics, or locale behavior. Update all affected code, tests, types, and documentation together.

## Architecture boundaries

- Browser requests use the same-origin Next.js BFF under `/api`; the BFF forwards to FastAPI and owns the HTTP-only session cookie. Do not expose backend credentials or move access tokens into browser storage.
- FastAPI and SQLAlchemy code is asynchronous. PostgreSQL is the system of record. Redis is currently used for best-effort gateway/rate-limit behavior, not as a primary datastore.
- Buyer, seller, and admin access must be enforced by the backend even when the frontend hides an action.
- Database schema changes require an Alembic revision. Never replace a migration with startup-time schema mutation.

## Working method

1. Reproduce or define the expected behavior.
2. Make the smallest coherent change that follows existing module boundaries.
3. Add or update tests for success, invalid input, and unauthorized access where applicable.
4. Run targeted checks while iterating, then the required final gate below.
5. Report changed files, commands run, and any check that was skipped or failed. Never claim a check passed unless it was run.

Do not leave placeholders, mock success paths, commented-out implementations, or unrelated formatting churn in production code.

## Verification gates

Use the repository scripts from the repository root:

```bash
./scripts/verify-frontend.sh
./scripts/verify-backend.sh                 # full backend suite; never run concurrently
./scripts/verify-backend.sh tests/test_chat_inquiries.py tests/test_chat_orders.py
./scripts/verify-all.sh
```

Minimum gate by change type:

| Change | Required verification |
|---|---|
| Documentation only | Check every documented path/command against current config; inspect the diff |
| Frontend TypeScript/data flow | `npm run check:harness`, `npm run lint`, relevant test, and `npm run check:i18n` when copy/messages change |
| Auth or Next.js BFF | Frontend checks plus `npm run test:auth-route` and browser/network inspection |
| Visual UI | Frontend checks plus live browser verification at relevant desktop/mobile widths |
| Backend architecture/import seam | `uv run python scripts/check_architecture.py` from `marketplace-svc/` |
| Backend behavior | Architecture guard plus targeted pytest file(s); run the full backend gate before handoff when practical |
| Model/schema | Alembic upgrade on the test DB plus relevant tests; include the migration |
| Auth, roles, payment, wallet, escrow | Test positive and negative/unauthorized paths; run the full backend gate |
| Cross-stack contract | Both frontend and backend gates plus live browser/network verification |

### Browser verification

For frontend work, default to Chrome DevTools or the available browser automation tool against the live app. Verify:

- layout and interaction at the affected viewport sizes;
- console errors and warnings;
- network status, request payload, and response payload;
- DOM/CSS state, focus behavior, loading, empty, error, and permission-denied states.

A build is not a substitute for browser verification. If browser tooling or a running dependency is unavailable, state that explicitly in the final report.

## Test database concurrency

Backend tests share `marketplace_test` and truncate its tables. Never run two pytest processes concurrently, including from separate agents or worktrees. `scripts/verify-backend.sh` uses a machine-wide lock to enforce this for harness-driven runs.

## Documentation maintenance

- Keep `README.md` focused on verified setup, architecture, and commands.
- Keep implementation-specific agent rules in the nearest `AGENTS.md`.
- Keep each `ARCHITECTURE.md` aligned with executable module-boundary checks and current migration state.
- Keep `DESIGN.md` as the frontend design contract. New UI follows it; legacy debt must be labelled rather than documented as compliant.
- Keep `CONTEXT.md` limited to the current chat domain contract. Mark reserved or prototype-only concepts as non-implemented.
- When behavior changes, update documentation in the same change; do not document aspirational behavior as if it exists.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Proxora frontend instructions

These rules extend the repository-root `AGENTS.md` for `frontend/`.

## Design and architecture authority

- Read the repository-root `DESIGN.md` before any visual, layout, interaction, shared-component, or user-facing copy change.
- Read `ARCHITECTURE.md` before changing module interfaces, shared abstractions, route/feature ownership, data ownership, or imports across layers.
- `DESIGN.md` overrides external skill aesthetics. Skills may improve composition, but may not rotate the Proxora palette, fonts, radius, icon family, status semantics, or component language.
- The system is a locked target with migration in progress. Do not copy nearby hard-coded legacy styles as precedent.
- Prefer the token-based `@/components/ui` primitives. Direct Radix dialog/tooltip imports are allowed; split Button/Card/Input/Select/Textarea/Badge files remain migration debt until tokenized.
- Do not introduce page-local raw colours, framework palette classes, a new primitive system, or per-page token files.
- New domain behavior belongs behind a feature public interface; routes compose features instead of owning queries, status mappings, or reusable workflows.
- Never update a harness baseline for ordinary feature work. A baseline increase requires an explicit reviewed architecture/design decision and the matching contract change.

## Mandatory design-skill routing

Classify the task before implementation and use at most one design lead plus one audit skill:

| Scope | Lead | Audit |
|---|---|---|
| Visual bug/preservation | No generative design skill | Browser/runtime check |
| Buyer, seller, admin, form, table, product workflow | `frontend-design` when available | Hallmark audit if useful |
| Public homepage, landing, solutions | `design-taste-frontend` | Hallmark audit |
| Existing redesign | Hallmark audit first; then choose the scope-appropriate lead | Hallmark audit again |
| URL/screenshot reference | `hallmark study`; wait for approval before adopting DNA | Runtime check |

`design-taste-frontend` is not used for admin dashboards, data tables, or multi-step product UI. Hallmark theme diversification is disabled for this system-managed project: structural variety is allowed, visual identity drift is not.

## Installed stack and local documentation

- The installed framework is Next.js 16.3 with React 19, App Router, TypeScript, Tailwind CSS 4, TanStack Query, and `next-intl`.
- Before changing a Next.js API, routing convention, cache behavior, middleware/proxy behavior, or configuration, read the relevant guide under `node_modules/next/dist/docs/`.
- Preserve the generated block above. `next dev` owns it.

## Application boundaries

- Locale routes live under `app/[locale]`. Supported locales are `en` and `vi`, both with an explicit URL prefix; `/` redirects to `/en` or `/vi` according to routing behavior.
- Browser API calls must remain same-origin under `/api`. `app/api/[...path]/route.ts` is the BFF and forwards server-side to `API_URL`/`BUILT_API_URL`.
- Authentication uses the HTTP-only `dx_session` cookie owned by the BFF. Never expose the token in a client response, `localStorage`, `sessionStorage`, a query string, or a `NEXT_PUBLIC_*` variable.
- `/internal/*` must not be forwarded through the public catch-all BFF. Preserve CSRF, admin-network, cookie, and response-header protections in that route.
- Use the existing client and domain types in `lib/api.ts` and `lib/types.ts`, TanStack Query keys/hooks, and shared UI primitives before creating another request layer or component system.

## Internationalization

- Shared user-facing copy belongs in both `messages/en.json` and `messages/vi.json` and should be consumed through `next-intl`.
- When changing message catalogs, run `npm run check:i18n` and fix missing, extra, or structurally mismatched keys.
- Do not couple display currency to locale. Ledger values remain in the backend-defined money unit; use the existing helpers under `lib/money/` and `lib/utils/`.
- Existing inline bilingual copy may be migrated when touched, but avoid unrelated catalog churn.

## UI and accessibility

- Follow `DESIGN.md`; preserve approved system decisions unless the task explicitly changes the system and updates that file.
- Reuse loading, empty, error, and permission-denied patterns. Do not implement only the happy path.
- Interactive controls must remain keyboard accessible, visibly focusable, semantically labelled, and usable at mobile and desktop widths.
- Use `@/components/Icons` as the icon API. Do not introduce another icon family, styling system, or state-management layer without a demonstrated gap.
- For dense data, use a desktop column header and aligned rows; repeat field labels only in the mobile stacked representation.
- A frequent primary workflow belongs on a route. Use a large data dialog only for contextual inspection and preserve focus, close, scroll, and mobile behavior.

## Verification

The default frontend gate from the repository root is enough for ordinary work. It does **not** production-build:

```bash
./scripts/verify-frontend.sh
```

Equivalent commands from `frontend/` when iterating on a subset:

```bash
npm run check:harness
npm run lint                 # TypeScript: tsc --noEmit
npm run check:i18n
npm test
```

Do not run `npm run build` unless `next.config`, middleware/proxy, or the BFF compile path changed, or the user asked for a full handoff:

```bash
RUN_FRONTEND_BUILD=1 ./scripts/verify-frontend.sh
```

Additional requirements:

- Auth, session, proxy, middleware, or BFF changes require `npm run test:auth-route` (included in `npm test`) and live browser/network inspection.
- UI changes require live browser checks at the affected desktop and mobile widths, plus console inspection.
- API contract changes require synchronized backend schemas/tests and frontend types/callers.
- A successful production build does not prove runtime behavior; verify interactions against a running backend when the task affects them.

# Proxora Frontend Architecture

> **Status:** target contract · migration in progress
> **Scope:** `frontend/` module seams, dependency direction, and reusable interfaces
> **Visual contract:** [`../DESIGN.md`](../DESIGN.md)
> **Rule:** new and touched code follows the target; legacy structure is not precedent.

This contract makes the reusable path predictable for humans and coding agents. It does not require a repository-wide rewrite.

## 1. Design objective

Build **deep modules**: substantial behavior behind a small interface at a clean seam.

- **Module:** feature, pattern, primitive, hook, function, or infrastructure package with one interface.
- **Interface:** everything callers need to use the module correctly, including types, states, errors, and invariants.
- **Implementation:** internal code hidden behind that interface.
- **Seam:** the location where the interface lives.
- **Adapter:** a concrete implementation used at a seam where behavior genuinely varies.

Prefer leverage and locality over a large collection of shallow wrappers. If deleting a shared module would merely delete indirection, it is not earning its place.

## 2. Target dependency graph

```text
app/routes
    ↓
features
    ↓
components/patterns
    ↓
components/ui

features ──→ lib/api · lib/domain · lib/utils
app/api  ──→ server-only BFF infrastructure
```

Dependencies point downward. Lower layers never import higher layers.

## 3. Responsibilities

### `app/`

The route layer owns:

- Next.js files and route composition;
- locale/layout boundaries;
- server/client entry-point decisions;
- route metadata and route-level authorization redirects.

A route does not own query keys, request orchestration, domain status mapping, reusable forms, or visual primitives. A mature page should primarily compose feature interfaces.

The same-origin BFF under `app/api/` is server infrastructure and remains separate from visual route composition.

### `features/<feature>/`

A feature is the default home for product behavior such as orders, wallet, products, chat, or deposits.

```text
features/orders/
├── index.ts          # external interface
├── model/            # domain-facing types, state and mappings
├── data/             # queries, mutations and cache ownership
├── ui/               # domain-aware UI
└── tests/             # tests through the feature interface
```

The public `index.ts` is the feature seam. Other modules do not deep-import its implementation.

A feature owns:

- query keys and API orchestration for its domain;
- mutation invalidation and optimistic behavior;
- domain-to-view mapping;
- feature forms and domain-aware status components;
- loading, empty, error, permission and success behavior;
- feature-level tests.

Do not force every feature to contain every directory. Create only the implementation its interface needs.

### `components/patterns/`

Patterns are cross-domain product structures composed from UI primitives, for example:

- `PageHeader`;
- `Toolbar`;
- `DataSurface`;
- `MetricStrip`;
- `EmptyState`, `ErrorState`, and `PermissionState`;
- `DataDialog`.

Patterns know interaction and layout semantics but not order, wallet, seller, or admin business rules. They may import `components/ui` and pure utilities only.

### `components/ui/`

UI primitives are domain-free visual and interaction building blocks. Their public interface is `@/components/ui`.

- A primitive owns variants, sizing, accessibility, and interaction states.
- Callers provide semantics through typed props, not raw palette classes.
- UI primitives do not fetch data, know routes, or import features.
- Radix is an implementation detail behind the public interface.

The current `components/ui.tsx` and `components/ui/*` overlap is migration debt documented in `DESIGN.md`. Do not add a third system.

### `lib/`

`lib/` contains infrastructure and genuinely cross-domain pure code:

- same-origin API client and transport errors;
- auth/session infrastructure;
- money/date formatting and value helpers;
- small pure utilities.

It must not become a dumping ground. A utility that only serves one feature stays in that feature. Infrastructure does not import route or UI modules.

### Legacy `components/<domain>/` and `hooks/`

`components/admin`, `components/orders`, `components/seller`, shared root components with API access, and top-level `hooks/` predate the target feature structure. They may be migrated when touched but are not precedents for new domain modules.

## 4. Interface rules

- Each feature has one public `index.ts` interface.
- Cross-feature imports go through that interface, never an internal file.
- Keep the interface smaller than the implementation it hides.
- Return observable results rather than requiring callers to inspect internal state.
- Accept dependencies at real seams; do not create speculative ports for one implementation.
- Production plus a test adapter is a valid real seam for remote/external dependencies.
- Tests and callers use the same interface.
- Do not export implementation helpers solely to make tests reach inside a module.

## 5. Reuse rules

Reuse is based on stable behavior and semantics, not similar-looking JSX.

### Promote immediately

- Design-system primitives.
- Security/session boundaries.
- Money and status semantics that must be globally consistent.
- Infrastructure used behind an established seam.

### Keep local first

The first domain-specific occurrence stays inside its feature. At the second occurrence, compare invariants. Promote only when behavior, states, and semantics are actually shared.

### Avoid

- `GenericTable`, `UniversalForm`, or configuration objects that reproduce JSX as data;
- wrappers that rename every underlying prop without hiding complexity;
- giant `shared/`, `common/`, or `utils.ts` modules;
- a component variant implemented through arbitrary caller `className` values;
- duplicated query keys, status mappings, error normalization, or mutation invalidation.

A generic mechanism may live in a pattern while domain declaration remains in the feature. For example, `DataSurface` owns collection states; `OrdersTable` owns order columns and actions.

## 6. State ownership

- Server state: TanStack Query inside the owning feature data module.
- URL state: filters, pagination, sort, and shareable selection when navigation should preserve them.
- Form state: local to the owning feature form unless multiple routes truly share the workflow.
- Ephemeral view state: local to the smallest module that needs it.
- Auth/session: existing auth infrastructure; never duplicate it in a feature.
- Domain status mapping: feature model module, rendered through canonical status primitives.

Do not mirror server state into component state without a documented editing or optimistic-state reason.

## 7. Data and error flow

```text
lib/api transport
    ↓
feature data module
    ↓
feature model/result
    ↓
feature UI
    ↓
route composition
```

- Transport errors are normalized once.
- Feature modules translate transport details into user-relevant states.
- Routes do not switch on HTTP status codes to implement domain behavior.
- Mutations own cache invalidation close to their query keys.
- Financial display uses canonical money helpers; locale never changes ledger units.

## 8. Agent implementation preflight

Before coding, record:

```text
Surface: PUBLIC | BUYER | SELLER | ADMIN
Owning module: <existing feature or proposed local module>
Existing interfaces reused: <list>
New interface: <none or concise description>
States: loading · empty · error · permission · success
```

Then:

1. Search for an existing interface and a second real call site.
2. Decide whether the change belongs in route, feature, pattern, primitive, or infrastructure.
3. Keep implementation behind the smallest useful interface.
4. Add tests through that interface.
5. Run the relevant direct tests before browser verification.

## 9. Migration sequence

1. Consolidate `components/ui.tsx` and `components/ui/*` behind one public interface.
2. Introduce patterns only from proven repeated structures.
3. Move one domain at a time into `features/`, beginning with high-change routes.
4. Replace tests that reach through old shallow modules with tests at the new feature interface.

Do not create empty feature directories, pass-through wrappers, or a repository-wide rewrite merely to match this document.

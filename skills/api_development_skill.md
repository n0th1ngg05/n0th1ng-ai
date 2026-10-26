---
name: api-development-standards
description: Use when building, modifying, or debugging any API endpoint in this FastAPI backend — new routes, new services, auth/authorization changes, DB schema or query changes, or integrating with the existing frontend contract. Audited directly from the existing offline_ai_backend codebase (app/core, app/models, app/schemas, app/services, app/api/v1), not invented.
---

# API Development Standards — offline_ai_backend

## 1. Purpose and scope

This skill captures the actual, verified conventions already in use in this
FastAPI backend, so every future endpoint follows the same shape as the
existing 90+ routes rather than introducing a new pattern. It applies to:
adding a new endpoint, modifying an existing one, adding/changing auth or
authorization, changing the DB schema, adding a new service file, or
debugging why an existing endpoint doesn't match the frontend's
expectations.

This is NOT a generic "FastAPI best practices" document. Every rule below
was confirmed against real files in this repository at audit time. Where a
rule reflects a genuine gap or risk rather than a strength, it is marked
**[GAP]** — follow the existing pattern where one exists, but do not treat
a **[GAP]** as something to silently copy into new code without raising it.

## 2. Project architecture

One FastAPI process, internally modularized by concern — not literally
separate microservices, but strict separation so each concern is
independently readable and swappable:

```
app/
├── main.py              — FastAPI app instantiation, router mounting, lifespan, CORS. NO business logic.
├── core/
│   ├── config.py         — pydantic-settings Settings, all env vars declared here
│   ├── database.py        — async SQLAlchemy engine/session + ensure_db_schema() startup bootstrap
│   ├── redis.py           — async Redis client/pool (lazy singleton)
│   ├── security.py        — password hashing (bcrypt), JWT encode/decode. NO endpoint logic, NO DB queries.
│   └── response.py        — {success, message, data, errors, verification_required} envelope + exception handlers + paginated_data()
├── models/                — SQLAlchemy 2.0 ORM models (Mapped[...], mapped_column), one file per table group
│   └── base.py            — Base, UUIDMixin (native Postgres UUID), TimestampMixin, SoftDeleteMixin (with hybrid_property is_deleted)
├── schemas/                — Pydantic request models, one file per domain, each traced to the specific frontend file that calls it
├── services/                — ONE FILE PER CONCERN/DOMAIN. Business logic + DB queries live here. No FastAPI Request/Response objects.
└── api/v1/                 — thin FastAPI routers. Parse request → call a service function → wrap in success_response()/AppError. No business logic, no raw DB queries here.
```

Rule of thumb for any new code:
- Touches HTTP request/response shape? → `api/v1/*.py` router, kept thin.
- Business rule or multi-step workflow? → a `services/*_service.py` function.
- Raw DB query? → the relevant `services/*_service.py` — never inline a
  query in a router.
- New domain/table (e.g. a future "events" feature)? → new
  `models/events.py` + `schemas/events.py` + `services/event_service.py` +
  `api/v1/events.py`, following the exact same four-file shape as every
  existing domain (schools, academics, users, locations).

## 3. Pre-implementation checklist

Before writing any new endpoint or modifying an existing one:

1. **Find the frontend contract first, if one exists.** Every existing
   schema file in this repo was traced from a specific frontend file (e.g.
   `app/schemas/school.py` is traced from
   `src/pages/schools/CreateSchoolPage.helpers.js`). If the frontend already
   calls this endpoint, read the actual frontend code (API constants, the
   action/service file that builds the request, the component that reads
   the response) before writing the backend — the backend conforms to the
   frontend, not the reverse, in this project.
2. **Check whether a similar domain already exists.** If adding, say, a new
   list+CRUD resource, open an existing one of the same shape (e.g.
   `app/services/school_service.py` + `app/api/v1/schools.py`) and match its
   pagination, soft-delete, and serialization patterns exactly rather than
   inventing a new shape.
3. **Identify the correct auth level.** Reads generally use
   `get_current_user_id` (any authenticated user); writes
   (create/update/delete/export) generally use `get_current_admin_user_id`.
   Confirm which applies by checking a comparable existing endpoint, not by
   assuming.
4. **Check for an existing ORM model for the data involved** in
   `app/models/` before creating a new one — table groups are already split
   across `user.py`, `school.py`, `academic.py`, `location.py`,
   `assignments.py`.
5. **Decide if this needs a DB migration.** This project applies schema via
   `sql/init.sql`, executed once by `ensure_db_schema()` on startup (see
   section 8) — there is no Alembic/migration tool in use. A schema change
   means editing `sql/init.sql` directly; be aware this only applies
   automatically to a *fresh* database (gated by a sentinel table check),
   so an already-running database needs the DDL applied manually.

## 4. API design standards

- **Base prefix**: every router is mounted under `settings.API_V1_STR`
  (`/api/v1`) in `main.py`.
- **Resource routes commonly support both singular and plural paths** on
  the same handler via stacked `@router.get("/school")` /
  `@router.get("/schools")` decorators — this project's established pattern
  for backward/forward compatibility with different frontend callers. Match
  this when adding a route that could reasonably be referenced either way.
- **HTTP methods**: `GET` for reads (list + detail), `POST` for create,
  `PATCH` for partial update (not `PUT`, except where the frontend contract
  specifically requires `PUT` — e.g. `/role-permissions/{role_id}` exposes
  both `PUT` and `PATCH`), `DELETE` for soft-delete.
- **List endpoints** take `page`, `limit`, `search`, and relevant filter
  query params (e.g. `status`, `state_id`), and return via
  `paginated_data()` (see section 6) — not a bare list.
- **Status codes**: `200` default success, `201` on create
  (`status_code=status.HTTP_201_CREATED` explicitly set on the route
  decorator), `400` for validation/conflict errors raised as `AppError`,
  `401` for auth failures, `403` for inactive/forbidden accounts, `404` for
  not-found, `422` reserved for Pydantic validation errors (handled
  automatically, not raised manually), `429` for rate-limited actions
  (OTP cooldown), `500` only for the unhandled-exception catch-all — never
  raise a 500 deliberately from application code.
- **Response envelope — every endpoint, no exceptions**:
  ```json
  { "success": bool, "message": str, "data": {...} | null,
    "verification_required": bool, "errors": {...} | null }
  ```
  Success responses use `success_response()` from `app/core/response.py`.
  Error responses are raised as `AppError(message, status_code=..., errors=...)`
  and automatically re-shaped by the registered exception handlers — never
  raise FastAPI's `HTTPException` directly in new code (it IS handled by a
  fallback handler for safety, but `AppError` is the established
  convention and should be used instead).

## 5. Implementation conventions

- **File organization**: see section 2. One service file per domain; a
  domain's router, schema, service, and model files share a recognizable
  name (`school.py`/`school_service.py`/`schools.py` for the schools
  domain).
- **Naming**: snake_case for all Python identifiers, functions named by
  verb+noun (`create_school`, `get_school`, `update_school_class_section`,
  `_serialize_schools` for private helpers prefixed with `_`).
- **Service function signature convention**: `async def
  action_name(db: AsyncSession, payload: SomeRequest) -> dict[str, Any]`
  for mutations; list endpoints take explicit pagination/filter params
  rather than a single query-object; return plain dicts (already JSON-
  serializable shapes), not ORM objects, from service functions — routers
  pass these straight into `success_response(data=...)`.
- **N+1 avoidance**: batch-fetch related rows via a single `WHERE id IN
  (...)` query and build an in-memory lookup dict, rather than querying per
  row in a loop — see `_serialize_schools()` in `school_service.py` for the
  established pattern (batched state/district/ulb/ward/admin lookups).
- **Dual-key serialization for frontend compatibility**: several existing
  serializers emit both an old and new field name for the same value (e.g.
  `phone` and `phone_number`, `name` and `full_name`) where the frontend
  historically used inconsistent field names across pages. Follow this
  pattern only when a specific frontend inconsistency requires it — don't
  default to emitting duplicate keys without a concrete reason traced to
  frontend code.
- **Pydantic schemas use `model_config = ConfigDict(extra="allow")`**
  throughout request models in this project — permissive toward extra
  fields the frontend might send. This is an established convention, not
  an accident; match it in new schemas unless there's a specific reason to
  be strict.

## 6. Validation and error handling

- Request validation happens via Pydantic field constraints
  (`Field(min_length=..., max_length=..., pattern=...)`) in `schemas/*.py`
  — not manual validation inside route handlers or services.
- Expected business-logic failures (duplicate record, invalid reference,
  not found, invalid credentials) are raised as `AppError(message,
  status_code=N, errors={field: "reason"})` from service functions — see
  `create_school()`'s duplicate-UDISE-code check in `school_service.py` for
  the canonical example.
- `app/core/response.py` registers five exception handlers, applied in this
  precedence: `AppError` (application-raised), `StarletteHTTPException`,
  `RequestValidationError` (automatic Pydantic failures → re-shaped into
  `errors` as a field→message dict), `IntegrityError` (SQLAlchemy/Postgres
  constraint violations → generic "Invalid reference ID or duplicate record
  conflict" message, no raw DB error ever reaches the client), and a
  catch-all `Exception` handler that logs via `print(...)` **[GAP: not
  structured logging — see section 9]** and returns a generic 500 message,
  never a raw traceback.
- Pagination metadata is built exclusively through `paginated_data()` —
  returns `{"list": [...], "pagination": {page, limit, size, total,
  total_count, total_page, totalPages, has_more, extra}}`. Note the
  deliberate field-name duplication (`total_page`/`totalPages`,
  `total`/`total_count`) — this mirrors a dual-key accommodation for
  different frontend pages expecting different casings; preserve it when
  touching this function.

## 7. Authentication and authorization

- **JWT-based**, stateless access tokens issued only after OTP verification
  (not directly on password check) for the Super Admin/staff login flow;
  a separate OTP-only flow exists for students (`/auth/student/*`).
- `app/core/security.py` holds pure token/hash logic only — `hash_password`,
  `verify_password`, `create_access_token`, `create_password_reset_token`,
  `decode_token` — no FastAPI imports, no DB queries. This separation is
  deliberate; don't add `Depends()`-based dependencies here.
- **FastAPI auth dependencies live in `app/api/v1/auth.py`** (not
  `core/security.py`), because they need `HTTPAuthorizationCredentials` /
  `Depends()`:
  - `get_current_user(db, credentials)` → resolves and returns the full
    `User` ORM object from a valid access token, 401 on invalid/expired.
  - `get_current_user_id` → thin wrapper returning just the UUID, used by
    most read endpoints.
  - `get_current_admin_user_id` → additionally checks the resolved user's
    `user_type`/role is an admin-tier role, 403 otherwise. Used by all
    create/update/delete/export endpoints across the audited routers.
- **Password reset uses a separate, short-lived, single-purpose JWT**
  (`purpose: "password_reset"` claim, distinct from the normal access
  token's `purpose: "access"`), validated only by `/reset-password`, and
  marked single-use via a Redis key keyed by the token's `jti` — a reused
  reset link fails even before its natural expiry.
- **OTP delivery**: Gmail SMTP via `aiosmtplib`, with a `SMTP_DEV_MODE`
  config flag that prints the OTP to console/logs instead of sending when
  no real Gmail App Password is configured — allows full login flow testing
  without live SMTP credentials. OTPs are stored in Redis with TTL
  (`OTP_EXPIRE_SECONDS`), purpose-scoped keys (`otp:{purpose}:{email}`) so
  a login OTP can't be replayed against the forgot-password flow, a
  wrong-attempt counter that invalidates the OTP after
  `OTP_MAX_ATTEMPTS`, and a resend cooldown
  (`OTP_RESEND_COOLDOWN_SECONDS`) enforced via a separate Redis TTL key.
- **Role permissions ARE looked up and returned to the frontend**
  (`RolePermission` table, joined by `user_type` in `auth_service.py`'s
  login/me response, returned as a `permissions` array) **but this is
  display/UI-gating only** — **[GAP, verified]**: no audited endpoint
  checks `permission_codes` before allowing a write. Authorization is
  currently a binary split (`get_current_user_id` vs
  `get_current_admin_user_id`), not fine-grained per-permission
  enforcement. Do not assume `role_permissions` is enforced server-side
  when writing new endpoints — if an endpoint needs real per-permission
  gating, that check must be added explicitly; it does not currently exist
  as reusable middleware/dependency.
- **[GAP]**: No general-purpose HTTP rate limiting exists (no `slowapi` or
  equivalent). The only rate-limiting in the codebase is the OTP-resend
  cooldown inside `otp_service.py`. Login attempts, password-reset
  requests, and all other endpoints have no brute-force protection beyond
  normal auth checks. Flag this if asked to harden the API; don't assume
  it's already covered.

## 8. Database integration

- **PostgreSQL 16, SQLAlchemy 2.0 async ORM (`Mapped[...]`,
  `mapped_column`), asyncpg driver.** Connection string built in
  `core/config.py`'s `ASYNC_DATABASE_URL` property.
- **All application tables live in the `offlineai` Postgres schema**, not
  `public` — this is deliberate: a separate downstream service
  (`offline_ai`, a content/lesson microservice) reads this schema as a
  read-only mirror. Any new table must be created inside `offlineai.` to
  stay consistent.
- **No migration tool (no Alembic).** Schema is defined in `sql/init.sql`
  as a single idempotent script (`CREATE TABLE IF NOT EXISTS` throughout).
  `app/core/database.py`'s `ensure_db_schema()` runs on app startup: it
  connects via raw `asyncpg`, checks for a sentinel table
  (`offlineai.role_permissions`) to decide whether `init.sql` has already
  been applied, executes the whole script if not, then separately checks
  for and seeds the Super Admin user from `SUPER_ADMIN_EMAIL`/
  `SUPER_ADMIN_PASSWORD` env vars if that email doesn't already exist. This
  means: an already-initialized database will NOT re-apply schema changes
  made to `init.sql` later — a change to an existing table's DDL requires a
  manual `ALTER`/migration step, this bootstrap only handles first-run
  initialization.
- **Native Postgres UUID primary keys** (`UUID(as_uuid=True)`,
  `gen_random_uuid()` default via the `pgcrypto` extension) — not
  string-UUIDs, not serial integers. Every new table's primary key should
  follow this.
- **Soft deletes, not hard deletes**, via `SoftDeleteMixin`
  (`deleted_at`/`deleted_by` columns + a `is_deleted` hybrid property that
  works as both a Python bool check and a SQL expression in `.where()`
  clauses). Every read query across existing services filters
  `.where(Model.is_deleted.is_(False))` (or the equivalent raw
  `deleted_at.is_(None)` where the mixin isn't used) — new read queries
  must do the same or soft-deleted rows will leak into results.
- **Transactions**: `db.add(obj)` → `await db.flush()` (to obtain a
  generated ID needed by subsequent related-row writes within the same
  logical operation) → perform related writes → single `await
  db.commit()` at the end of the service function. Services do not call
  `db.begin()` explicitly — `AsyncSessionLocal` sessions are used directly,
  with rollback handled by `get_async_db()`'s `try/except` in
  `core/database.py` on any unhandled exception during the request.
- **N+1 avoidance is a hard expectation** — batch-fetch via `IN` clauses,
  not per-row queries in a loop (see section 5).

## 9. Configuration management

- **All configuration via `pydantic-settings`** in `app/core/config.py`
  (`class Settings(BaseSettings)`), reading from a `.env` file. No
  hardcoded credentials, URLs, or secrets anywhere in application code —
  every value that could differ between environments is a `Settings`
  field.
- **Required vs. defaulted fields**: Postgres connection fields and
  `JWT_SECRET_KEY` have no default (app fails to start if missing from
  `.env`) — this is intentional fail-fast behavior, preserve it for any new
  required secret.
- `.env.example` is the canonical, documented template — thoroughly
  commented with setup instructions for each section (Postgres, Redis,
  JWT, OTP, Gmail SMTP, Super Admin seed). Keep it in sync with any new
  `Settings` field added to `config.py`.
- **[GAP, verified]**: `SUPER_ADMIN_PASSWORD`'s default value in
  `config.py` (`Test@1234`) does not match the documented default in
  `.env.example` (`Admin@1234`). Whichever value is actually set in a
  real deployment's `.env` is authoritative, but these two files should be
  reconciled to avoid confusion; don't propagate this drift when editing
  either file.
- **SMTP_DEV_MODE pattern**: a boolean config flag that changes a service's
  real-world side effect (send email vs. print to console) based on
  whether real credentials are configured — useful pattern to replicate
  for any other external integration added later that has a similarly
  awkward local-dev credential requirement.

## 10. Security checklist

Confirmed as actually implemented in this codebase — use as a checklist
for new endpoints, not as an assumption that every item is automatically
covered by existing infrastructure:

- [ ] Auth: route requires `get_current_user_id` (read) or
      `get_current_admin_user_id` (write), as appropriate — confirmed
      present on every audited endpoint except intentionally-public ones
      (login, forgot-password, etc.)
- [ ] Password hashing: bcrypt via `core/security.py`'s `hash_password` —
      never store or compare plaintext.
- [ ] Login timing: a dummy bcrypt hash is compared even for an unknown
      email, to avoid leaking account existence via response timing —
      preserve this pattern in any new credential-check endpoint.
- [ ] Forgot-password does not reveal whether an email exists — always
      returns a generic success message, only actually sends if the
      account is real.
- [ ] Input validation: Pydantic field constraints on every request
      schema, not manual checks.
- [ ] SQL injection: not applicable by construction — all queries go
      through SQLAlchemy's query builder (`select()`, parameterized
      `.where()`), no raw string-interpolated SQL in application code
      (the one exception, `ensure_db_schema()`'s `init.sql` execution, is
      a fixed script read from disk, not user input).
- [ ] Error responses never leak stack traces or raw exception text to the
      client — confirmed via the catch-all handler in `response.py`.
- [ ] CORS: currently `allow_origins=["*"]` in `main.py` — **[GAP]**
      explicitly flagged in the code's own comment as needing tightening
      to the real frontend origin before any production/public deployment.
      Do not treat wildcard CORS as the permanent intended state.
- [ ] **[GAP]** No general rate limiting beyond OTP-resend cooldown — see
      section 7. Do not assume login/reset endpoints are brute-force
      protected.
- [ ] **[GAP]** `role_permissions` is not enforced server-side on any
      audited write endpoint — see section 7. Treat the permission-code
      system as UI-gating only until/unless real enforcement is added.

## 11. Testing requirements

**[GAP, verified]**: no automated test suite (no `pytest`, no `tests/`
directory) was found anywhere in the audited repository. There is no
existing testing convention to follow. For any new endpoint, at minimum
manually verify via curl or the FastAPI `/docs` interactive UI:
- A successful request with valid auth and valid payload.
- An unauthenticated request (expect 401).
- A request from a non-admin user against an admin-only endpoint (expect
  403).
- An invalid payload (expect 422 with a field-level `errors` object).
- A duplicate/conflicting record where applicable (expect 400 with a
  specific `AppError` message, not a raw `IntegrityError`/500).
- A not-found ID (expect 404).

If the project later adopts `pytest`, this section should be rewritten to
reflect the actual testing conventions established at that point — don't
invent a testing framework or assert tests exist where none were found.

## 12. Documentation requirements

- FastAPI's auto-generated OpenAPI docs (`/docs`, `/redoc`) are the primary
  API documentation — no separate hand-written API reference was found in
  the repository beyond `PROJECT_DOCUMENTATION.md`,
  `OFFLINE_AI_COMPLETE_DOCUMENTATION.pdf`, and `setup.md` (general
  project/setup docs, not per-endpoint specs).
- Every schema and service file in this project carries a module-level
  docstring explaining what it covers and, where applicable, which
  specific frontend file/page it was traced from (e.g. "traced from
  src/pages/schools/CreateSchoolPage.helpers.js"). Continue this practice
  for new domains — it's what makes the backend's contract traceable back
  to its actual consumer rather than documented from memory.
- When an API contract changes (new field, changed response shape, new
  endpoint), update the relevant schema file's docstring and, if a
  `README.md`/`setup.md` curl example references that endpoint, update
  that too.

## 13. Integration requirements

- **New endpoints must conform to the frontend's existing contract when
  one exists** — do not change response shapes to be "more correct" if
  the frontend already depends on the current shape; the frontend in this
  project is the fixed point, the backend adapts to it (see section 3).
- **The `offlineai` schema is shared with a separate downstream service**
  (`offline_ai`) that reads it read-only. Any schema change to an existing
  table (especially `users`) must not break that service's expectations —
  check `offline_ai`'s own mirror models if making a breaking change to a
  shared table.
- **Redis is shared infrastructure** for OTP storage — a new feature
  needing its own Redis-backed state (e.g. a cache, a different kind of
  rate limit) should use a distinctly prefixed key namespace
  (`otp:`, `otp_attempts:`, `otp_cooldown:`, `used_reset_token:` are
  already in use) to avoid collisions.

## 14. Verification checklist

Before considering any new or modified endpoint complete:

- [ ] Endpoint registered under the correct router, correct HTTP method,
      correct path (check for an existing singular/plural pair convention
      if this is a resource endpoint).
- [ ] Request validated via a Pydantic schema with appropriate
      `Field(...)` constraints.
- [ ] Correct auth dependency applied (`get_current_user_id` vs
      `get_current_admin_user_id`) — verified by testing both an
      authenticated-non-admin and an admin request if the distinction
      matters for this endpoint.
- [ ] All expected failure paths raise `AppError` with an appropriate
      `status_code` and clear `message` — not a bare exception, not
      `HTTPException`.
- [ ] Soft-delete filtering applied to every read query touching a
      `SoftDeleteMixin` table.
- [ ] No N+1 query pattern introduced for any list/detail endpoint
      returning related data.
- [ ] Response wrapped via `success_response()` (or `paginated_data()` for
      list endpoints), matching the `{success, message, data, errors,
      verification_required}` envelope exactly.
- [ ] No secret, credential, or environment-specific value hardcoded
      anywhere in the new code — added to `Settings` in `config.py` and
      documented in `.env.example` if a new config value was needed.
- [ ] Manually tested: success case, unauthenticated case, (if relevant)
      wrong-role case, invalid-payload case, not-found case — see section
      11, since no automated suite exists to run instead.
- [ ] If this endpoint is consumed by the real frontend, its actual
      calling code (API constant, action file) was checked and the
      response shape matches what that code reads.

## 15. Anti-patterns — confirmed violations of established project convention

- Raising `HTTPException` directly in new route/service code instead of
  `AppError` — breaks the project's uniform response envelope.
- Returning a bare list or ORM object directly from a router instead of
  going through `success_response()`/`paginated_data()`.
- Querying related rows one-at-a-time inside a loop instead of a batched
  `IN` lookup (N+1) — this project's existing serializers specifically
  avoid this; don't introduce it in new code.
- Forgetting `.where(Model.is_deleted.is_(False))` (or the equivalent) on
  a new read query — silently returns soft-deleted rows.
- Hardcoding a secret, URL, or environment-specific value instead of
  adding it to `Settings`.
- Adding a new table outside the `offlineai` Postgres schema.
- Writing a migration tool/Alembic setup without being asked — this
  project's established approach is a single idempotent `init.sql`
  applied by `ensure_db_schema()`; introducing a second,
  differently-conventioned migration mechanism would fragment the
  project's actual practice. If a real migration tool is wanted, that's a
  deliberate architectural decision to raise explicitly, not something to
  default into.
- Assuming `role_permissions`/`permission_codes` enforce anything on the
  backend — they don't, currently (see section 7); don't build a new
  endpoint that silently relies on them being checked elsewhere when they
  aren't.
- Loosening CORS further, or treating the current `allow_origins=["*"]` as
  intentional/final rather than a flagged temporary state.

## 16. Execution workflow — repeatable procedure for a new or modified endpoint

1. Read the relevant frontend code first, if the frontend already expects
   this endpoint (API constant file, the action/service function building
   the request, the component reading the response). If there is no
   frontend yet, write the contract down clearly before coding (field
   names, types, response shape) so it can be checked later.
2. Find the closest existing analogous endpoint/domain in this codebase
   and use its router + service + schema + model as the structural
   template — don't design from scratch when a precedent exists.
3. Add/extend the ORM model in `models/` if needed (native UUID PK,
   correct mixins, correct `offlineai` schema).
4. Add/extend `sql/init.sql` for any new table or column (idempotent
   `CREATE TABLE IF NOT EXISTS` / safe `ALTER` as appropriate) — remember
   this only auto-applies to a fresh DB; note if a manual step is needed
   for an existing one.
5. Write the Pydantic request schema in `schemas/`, with a docstring
   citing the frontend file it was traced from if applicable.
6. Write the service function(s) in the appropriate `services/*.py` —
   business logic + DB queries, raising `AppError` for expected failures,
   batching related-row fetches, respecting soft-delete, single `commit()`
   at the end of a mutation.
7. Write the thin router handler in `api/v1/*.py` — parse request via the
   schema, apply the correct auth dependency, call the service function,
   wrap the result in `success_response()`/`paginated_data()`.
8. Mount the router in `main.py` if this is a new router file.
9. Manually verify every case in section 11's checklist.
10. Run through section 14's verification checklist in full.
11. Update `.env.example` if a new config value was introduced; update the
    relevant schema/service docstring if the contract changed.
12. Report back: which files changed, what the endpoint does, how it was
    tested and what the results were, and any **[GAP]**-flagged risk this
    new work touches or inherits (e.g. "this endpoint is admin-gated but
    not permission-code-gated, consistent with the rest of the project's
    current state").

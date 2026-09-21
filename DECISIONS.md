# DECISIONS.md

Last updated: 2026-09-21

Purpose: record durable architectural and operational decisions that future sessions should not casually rediscover or reverse.

This is not a changelog. Record the **decision, rationale, and boundary**; use `CHANGELOG.md` for version-by-version history.

## D-001 — Cloudflare Worker + D1 is the production backend

**Decision**

Cloudflare Worker + D1 is the sole active production backend for new capabilities.

**Rationale**

The formal Worker provides server-side identity, authorization, transactional mutations, relational state, migration control, and explicit production contracts.

**Boundary**

- GAS is retired from production.
- `gas/` and the explicit GAS adapter remain only for bounded legacy regression evidence / compatibility.
- Do not add new production business logic, identity logic, or authorization behavior to GAS unless explicitly authorized as a legacy task.
- Do not create Worker-to-GAS fallback behavior.

## D-002 — Canonical identity and authorization are server-owned

**Decision**

The Worker derives identity and authorization from authenticated credentials and canonical server-side records.

**Rationale**

Client-provided identity, role, balance, or target fields are not trustworthy authorization sources.

**Boundary**

- Do not authorize from client-supplied user IDs, role claims, balances, or display names.
- Preserve the separation between authenticated actor, read-only View As subject, and mutation target/effective subject.
- View As is read-only and must not become mutation authority.

## D-003 — Normal-user access does not require mandatory LINE binding

**Decision**

A normal User may use valid employee onboarding / employee-ID access without mandatory LINE binding, while LINE remains an optional identity enhancement.

**Rationale**

Normal-user application access and LINE ownership are related but distinct concerns. Requiring LINE binding for every normal-user path created unnecessary routing and onboarding coupling.

**Boundary**

- Multiple entry paths must converge on one canonical user rather than create duplicate users.
- Existing LINE ownership remains protected against conflicting reassignment.
- Admin / ProxyAdmin do not inherit this relaxed trust model; elevated roles remain under stricter identity and authorization requirements.

## D-004 — Sequenced ledger projection is the balance authority

**Decision**

When sequenced ledger rows exist, the latest sequenced ledger projection is the canonical balance authority.

**Rationale**

Historical evidence showed that relying on a stale `users.balance` mirror could create discontinuous ledger chains. The ledger sequence provides the authoritative mutation history.

**Boundary**

- `users.balance` is a mirror / fallback only when no sequenced ledger basis exists.
- Monthly or diagnostic arithmetic must not silently replace canonical sequenced closing balance.
- Historical repair requires a separately approved procedure with explicit before/after evidence and remote-write authorization.

## D-005 — Historical records are not rewritten to fit current normalized models

**Decision**

Historical orders, menu snapshots, menu revisions, and other historical evidence remain immutable by default.

**Rationale**

Current normalization rules may improve future/current interpretation without changing what historical transactions meant at the time.

**Boundary**

- Prefer append-only / effective-date projections for normalization.
- Do not retroactively rewrite historical transaction meaning merely to simplify current code.
- Any exceptional repair must be explicitly scoped, evidenced, and reviewed.

## D-006 — Content/configuration gaps must fail closed rather than fall back across transports

**Decision**

Worker production paths must surface explicit configuration or contract gaps rather than silently fall back to GAS or another authority source.

**Rationale**

Silent fallback creates multiple sources of truth and makes identity, authorization, and mutation semantics ambiguous.

**Boundary**

- Omitted production transport selects Worker.
- Unsupported Worker operations fail explicitly.
- Mock auth is a local development seam and is not a production fallback.

## D-007 — Remote mutation and deployment require evidence beyond local verification

**Decision**

Local tests, lint, and builds do not prove deployed Worker, LIFF, or production D1 behavior.

**Rationale**

Production identity, remote database state, CORS/runtime configuration, and external platform behavior cannot be established by static/local checks alone.

**Boundary**

Treat these as external/manual verification domains:

- real LIFF authentication;
- View As runtime behavior;
- Worker deployment;
- remote D1 contents;
- remote migrations;
- production import/repair.

Follow repository preflight/verification rules before any external write.

## D-008 — Shared Agent Platform skills remain upstream-managed

**Decision**

`.agents/skills/ap-safe-preflight` and `.agents/skills/ap-verification-core` are synchronized dependencies from the shared Agent Platform and are not the place for Bento-specific policy.

**Rationale**

Repo-local policy must survive future skill upgrades without being overwritten or forking shared skill behavior.

**Boundary**

- Put Bento-specific invariants in `AGENTS.md`, `PROJECT_STATE.md`, `DECISIONS.md`, or domain docs.
- Do not edit shared skill contents to encode repository-specific behavior.

## Maintenance rule

Add a new entry only when a choice is durable enough that a future Agent might otherwise reopen or reverse it.

Do not duplicate release notes, one-off implementation details, or temporary task status here.

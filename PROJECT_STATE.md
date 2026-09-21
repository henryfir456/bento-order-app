# PROJECT_STATE.md

Last updated: 2026-09-21

Purpose: record the **current effective state** of this repository. This is not a changelog and not a historical narrative.

If this file conflicts with code, tests, the active Worker schema, or verified production evidence, the actual repository/runtime evidence wins and this file must be updated.

## Current architecture

- Production backend: Cloudflare Worker + D1.
- Formal Worker runtime: `worker-poc/src/formalWorker.js`.
- Formal D1 migration chain: `worker-poc/migrations-formal/`.
- Frontend: React + Vite.
- Production frontend transport defaults to Worker.
- GAS is retired from production. `gas/` and the explicit GAS adapter remain only as legacy regression evidence / compatibility seams.
- The retained legacy POC is local-only and is not a production deployment target.

## Identity and authorization

- Worker-side canonical identity is authoritative.
- Bearer credentials determine authenticated identity; client-supplied user IDs, roles, balances, and display names are not authorization inputs.
- Normal Users may enter through LINE or employee-ID based flows and both paths must resolve to the same canonical user when they refer to the same person.
- LINE binding is not a mandatory prerequisite for normal-user access after valid employee onboarding.
- Admin and ProxyAdmin remain under stricter verified identity and authorization rules; employee-only / employee_guest flows must not grant elevated capabilities.
- Authenticated actor, optional read-only View As subject, and mutation target/effective subject remain distinct concepts.
- View As is read-only. Mutations must not inherit View As semantics.

## Ordering and delegated ordering

- Formal order behavior lives on Worker + D1.
- ProxyAdmin delegated ordering is restricted to eligible open dates at or after today, subject to calendar/menu/cutoff/authorization checks.
- Admin delegated ordering retains broader date authority under existing server-side checks.
- Order and cancellation mutations require the formal Worker mutation contracts and idempotency protections.
- Menu/calendar state is authoritative on the Worker side; the frontend must not recreate authorization or mutation policy locally.

## Balance and ledger

- The latest sequenced ledger projection is the canonical balance authority when sequenced ledger rows exist.
- `users.balance` is a mirror/fallback, not the primary authority once sequenced ledger data exists.
- Ledger history diagnostics may expose discontinuities or sequence/date boundary issues, but canonical closing balance is not silently replaced by arithmetic reconstruction.
- Historical repair proposals are not authorization for remote data mutation.
- Any ledger-history correction or remote repair remains a separately reviewed data-mutation task.

## Menu and history

- Historical menu/order records are treated as historical evidence and should remain immutable unless an explicitly reviewed migration/repair requires otherwise.
- Normalized menu projections may change future/current interpretation without rewriting historical order meaning.
- Vendor/menu identity must remain isolated by vendor and effective date.

## Deployment and remote-write boundary

Local verification can prove source-level and test-level behavior only.

The following require external/manual evidence and must not be reported as locally verified:

- real LIFF authentication;
- View As runtime behavior;
- deployed Worker behavior;
- production D1 contents;
- remote migrations;
- remote D1 repair/import;
- production deployment.

Remote D1 mutation, migration, production replacement/import, and deployment are explicit external-write operations. Follow `AGENTS.md`, `agent.yaml`, the relevant Worker docs, and the declared preflight/verification skills before execution.

## Verification baseline

Root required checks are declared in `agent.yaml`:

- `node --test tests/strict-identity-ledger.test.cjs`
- `npm run lint`
- `npm run build`

Worker-specific tasks may require additional checks from `worker-poc/`, task-specific docs, or the declared verification skill.

## Durable references

- Work rules and safety boundaries: `AGENTS.md`
- Machine-readable agent/skill contract: `agent.yaml`
- Durable rationale: `DECISIONS.md`
- Historical version evolution: `CHANGELOG.md`
- Worker/runtime details: `worker-poc/README.md`
- Identity architecture: `docs/identity-verification-architecture.md`
- Ledger diagnostics / repair analysis: `docs/ledger-consistency-repair-plan.md`
- React/Worker boundary: `docs/react-worker-cutover-matrix.md`

## Maintenance rule

Update this file only when a **current effective state** changes.

Do not append release history here. Put historical evolution in `CHANGELOG.md` and durable rationale in `DECISIONS.md`.

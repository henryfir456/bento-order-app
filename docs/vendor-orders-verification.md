# Issue #36 Draft verification handoff (2026-10-10)

Outcome: internal MANUAL implementation prepared for three stacked Draft
PRs. This is not production delivery. Issue #36 remains OPEN. No merge,
deployment, remote migration, production D1 mutation, third-party login/API
request, real order/payment or persistent credential was performed.

## Scope and governance

Repository: C:/Users/at318/Desktop/AI/80_bento-order-app. Main baseline:
5dd8667360f522c012a338641bd7ec584dab1ef4 / v0.15.15. Root AGENTS.md,
schema-2 agent.yaml, PROJECT_STATE.md, DECISIONS.md and only the manifest
skills ap-safe-preflight 0.2.0 / ap-verification-core 0.4.0 were resolved.
No shared skill, parent workspace or project-mech-grid file/process changed.
Existing task changes were preserved; no reset, clean or unrelated overwrite.

Profile IDENTITY_AUTH_HIGH_RISK / HIGH_RISK: schema, authorization,
concurrency, permanent reservations, source data integrity and API contract.
FAST gates: roots/manifest/paths/start ledger PASS; collision protection PASS;
governance-only scope FAIL (runtime changes); absence of high-risk signals
FAIL; release/canonical boundaries PASS (no new tag); capability probe and
deterministic governance tooling availability FAIL (probe absent); no prior
verification mismatch FAIL (captured baseline suites already fail).

Capability command tools/get-toolchain-capabilities.ps1: NOT RUN, file
absent. Read-only Get-Command node,npm.cmd,git succeeded; Node v24.20.
No typecheck script: NOT RUN. New release tag: not applicable; draft notes
are Unreleased, preserving the existing release version and history.

## Automated evidence

| Check / exact command | Result | Exit / evidence |
| --- | --- | --- |
| node --test tests/strict-identity-ledger.test.cjs | PASS | 0; 90 total, 87 pass, 3 skipped |
| npm.cmd run lint | PASS | 0; existing warnings only |
| npm.cmd run build | PASS | 0; Vite 128 modules; existing bundle-size warning |
| worker-poc: node --test tests/vendor-orders.test.js tests/vendor-order-migration.test.js | PASS | 0; 36/36 |
| node --test tests/vendor-order-workflow.test.cjs tests/vendor-order-ui.test.cjs | PASS | 0; 15/15 |
| node --test $testFiles (Get-ChildItem tests -Filter *.test.cjs, FullName array) | FAIL / PRE_EXISTING_FAILURE | 1; 238 total, 233 pass, 2 fail, 3 skipped |
| worker-poc: npm.cmd test | FAIL / PRE_EXISTING_FAILURE | 1; 505 total, 498 pass, 7 fail |
| git diff --check | PASS | 0 |

Root pre-change baseline: 223 total, 218 pass, 2 fail, 3 skipped. Current
failures remain tests/cancel-flow.test.cjs:115 and :120, stale source regex
for unchanged cancel-order balance ownership code. Worker pre-change:
469 total, 462 pass, 7 fail. Current failures remain formal-cleanup.test.js
at 302/341/358/382/397/421/481, sqlite_sequence inventory 3 vs expected 2.
The source-regex/cleanup implementation contracts are unchanged. No new
full-suite failure remains. Full suites are not claimed green and no GitHub
CI pass is inferred from these local runs.

Logs on this machine: Temp/bento-issue36-root-baseline.log,
bento-issue36-worker-baseline.log, bento-issue36-final-root.log,
bento-issue36-final-worker.log. Automated tests use disposable in-memory
SQLite/D1 and synthetic LINE profile responses; they never modify production.
Required checks ran in declared test -> lint -> build order.

Red-to-green defects include duplicate handoff/replay/races, explicit
variants collapsed by legacy projection, different internal items sharing an
external SKU at conflicting prices, cancelled replacement moved to another
floor, frozen reconciliation blocked by live size limits, own claims falsely
flagged as drift, raw Worker JSON rejected by UI, revoked branch cache and
malformed 403 cache retention. Notes require a current hash acknowledgement;
only separately approved supplier text appears in the sheet.

## Independent review and manual boundary

Initial core: independent file-level defect-first review and independent
32/32 execution PASS. Later core/UI follow-up: independent static review of
exact source snippets PASS, no remaining blocking finding. Independent latest
executable rerun NOT VERIFIED: Windows bridge/automatic approval review
timeouts and the default sandbox MXC D: error prevented those reviewer runs.
These were timeout/environment failures, not an unsafe-action rejection.
Primary agent subsequently executed the latest 36/36 and 15/15 results above.

Real LIFF authentication: NOT VERIFIED. View As/identity device behavior:
NOT VERIFIED (local handler/gating tests only). Responsive browser/Android
LINE usability: NOT VERIFIED (actual App closures and React SSR, no DOM or
device mount). Worker deployment/remote D1 production contract: NOT VERIFIED,
not performed under Draft-only authorization. Merchant availability,
acceptance, payment and official API authorization/sandbox: NOT VERIFIED.
GAS-only production checks: NOT RUN, retired transport outside feature scope.

## Deliverables and commit boundary

- P0: docs/vendor-orders-p0.md, Draft #37,
  d2b5e8b7e20e388f6d8f98834fcb9350fab6606c,
  docs(vendor-orders): record MaiFood feasibility and manual-only decision (#36).
- Core Draft #38: migration 0015/README/package scripts; auth/permissions;
  opt-in menu/menuItemChanges projection; vendorOrderAdapters/Policy/Orders;
  routes/vendorOrders and formalWorker; migration/core/runtime-config tests;
  docs/vendor-orders-manual-contract.md. Initial commit
  d2b701471cf769dbda7504f81d9339bec2e316b5; follow-up
  298d330f98f85e541cb82c6487c3312169464b2d,
  fix(vendor-orders): preserve frozen reconciliation and external SKU pricing (#36).
- UI: App/API integration, VendorOrderBatches.jsx and vendorOrderWorkflow.js;
  executable workflow/UI tests; Unreleased changelog and corresponding
  historical-preservation expectation; PROJECT_STATE Draft boundary; this
  verification document. Final UI commit and PR head are recorded in the
  stacked UI Draft PR metadata.

Pushed commits and Draft PR state are to be confirmed from GitHub metadata;
no tag or merge/deployment is part of this handoff. Remaining work: review
the Draft stack, address captured unrelated baseline debt separately, obtain
merchant authorization and sandbox evidence before enabling any official
adapter, and authorized real-device/manual acceptance testing. Official
adapter remains unconditionally OFF; internal idempotency does not promise
external exactly-once manual submission.

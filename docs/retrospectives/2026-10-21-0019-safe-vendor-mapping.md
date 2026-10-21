# 2026-10-21 — 0019 safe canonical Vendor mapping

- Repository, branch, PR, commit: `henryfir456/bento-order-app`; PR #143 (`fix/2026-10-21-0019-safe-vendor-identity`) was opened from the latest verified `main`.
- Goal / changes: remove historical `orders.vendor` name/alias backfill; add explicit append-only mapping from exact `menu_version_id` and effective date to canonical `vendor_id`; use only fully resolved same-vendor order lines for Vendor reads and settlement capacity; have new Worker orders write canonical IDs directly; mark old settlement snapshots/allocations unverified until safely regenerated.
- Delivery status: implementation and synthetic verification complete; PR #143 awaits independent re-review and merge. No formal D1, Worker, R2, payment, Cloudflare, or Windows executor operation was performed.

## Blockers and boundaries

| Observation / phase | Classification | Evidence | Attempt and result | Root cause |
| --- | --- | --- | --- | --- |
| Formal migration 0019 previously inferred order identity from display text | Data safety | Previous `0019_vendor_order_settlements.sql` updated existing `orders` using `orders.vendor` and an alias | Replaced with a nullable column plus immutable mapping/attribution logic; did not apply any migration remotely | Verified unsafe inference; historical labels do not prove a canonical Vendor identity |
| Existing environments may already have the earlier 0019 revision | Migration compatibility | Repository history contains the old trigger-based revision; formal D1 was last reported at 0014 in Issues #104/#139 | Added forward-only 0020 to drop the old name/alias triggers and replace the settlement capacity queries; it leaves every order row untouched | Verified migration compatibility requirement; no remote schema state was re-read this turn |
| Independent review found that old daily snapshots could still be reused as trusted settlement amounts | Settlement attribution | Reviewer identified that the legacy trigger and Vendor API selected existing snapshots without an attribution source | Added migration 0021 with nullable provenance columns; old snapshots and allocations remain unchanged with NULL provenance, API reads exclude them, and capacity uses current canonical attribution | Verified defect; old aggregates cannot be proven safe merely because they contain a vendor ID |
| Independent review found a verified snapshot could outlive an order cancellation | Settlement integrity | The allocation triggers trusted the latest verified snapshot as the full receivable cap even after the active canonical order total fell | Added `vendor_active_attributed_receivables`; both allocation insertion and adjustment now cap by the lower of current active attribution and the latest verified snapshot. The synthetic test first reproduced an incorrectly accepted extra payment, then confirmed the insert and positive adjustment are rejected after cancellation; the correction back to zero remains allowed | Verified stale-snapshot defect; append-only snapshots must not authorize above current active orders |
| Exact-head Worker CI exposed order-route failures after requiring canonical Vendor IDs for new orders | Synthetic fixture compatibility | The six failures returned 404 in guest-order, post-cutoff menu/order, and 9/21 order tests; those fixtures added calendar/menu rows after migration 0010 and had no matching canonical Vendor row | Added explicit synthetic Vendor masters to the affected fixtures and assertions that new orders persist the canonical ID; the affected suites now pass locally | Verified cause: the canonical lookup correctly fails closed when the Vendor master is absent; production behavior was not weakened |
| Wrangler local migration-engine integration test | Local runner | Four local-engine cases failed before Wrangler started because the sandbox denied Node child-process creation with `spawnSync ... EPERM`; the migration/schema tests use the SQLite-backed D1 harness successfully | Used the SQLite-backed migration/schema tests and synthetic Worker/API tests; made no Cloudflare or Windows executor calls | Process sandbox is the observed local-runner blocker; no evidence of a Cloudflare or production failure |
| Formal rollout and live API acceptance | Explicitly out of scope | User prohibited formal D1 modification and Worker deployment | No Cloudflare or Windows executor calls; no remote migration, payment, or API operation | Not performed by design; local results are not formal deployment evidence |

## Privacy publication check

- PII_SCAN: PASS after scanning the complete changed diff and new files; fixtures and explanations use synthetic data only.
- No real account, order, payment, employee, phone, LINE, credential, or production-row values were added.
- Issue and PR updates will describe only the code-level migration fix and remaining formal-release gates.

## Verification

- TDD: synthetic migration and Vendor-scope tests first exposed the historical text backfill / missing attribution behavior; independent review exposed both stale settlement-source reuse and the stale verified-snapshot-after-cancellation cap. The latter regression failed before the trigger fix because a new payment was accepted, then passed after the current-attribution bound. Exact-head CI later exposed missing synthetic Vendor masters in order fixtures. Each finding was reproduced before its scoped correction.
- `node tests/formal-schema.test.js` (`worker-poc/`): PASS, 25/25. Covers 0019 keeping historical rows unchanged/unmapped, mapping exact menu-version identity, latest revocation, append-only mapping, old inferred IDs remaining outside Vendor scope until a reviewed mapping resolves them, and 0021 preserving old settlement rows with NULL provenance.
- `node tests/orders-create.test.js` (`worker-poc/`): PASS, 9/9. Covers canonical ID written by the server-side order path and immutable order assignment.
- `node tests/vendor-operations.test.js` (`worker-poc/`): PASS, 8/8. Covers Vendor A/B isolation, unmapped/mixed/mismatched/future history excluded, stale snapshots excluded from reads, stale snapshots bounded by current active attribution after cancellation for both new allocations and adjustments, old allocations and Vendor responses hidden, safe snapshots appended above old revisions, settlement capacity based only on attributable orders, and synthetic payment operations separate from the employee ledger.
- `node tests/vendor-rbac.test.js` (`worker-poc/`): PASS, 8/8.
- `node tests/runtime-config.test.js` (`worker-poc/`): PASS, 6/6; migrations 0019–0021 are in the formal migration chain.
- `node tests/formal-drift.test.js` (`worker-poc/`): PASS, 7/7.
- `node tests/guest-access.test.js` (`worker-poc/`): PASS, 20/20; the order assertion also checks the saved canonical `vendor_id`.
- `node tests/menu-item-changes.test.js` (`worker-poc/`): PASS, 36/36.
- `node tests/orders-921-regression.test.js` (`worker-poc/`): PASS, 2/2; the order assertion also checks the saved canonical `vendor_id`.
- `node tests/changelog-migration.test.cjs` (repository root): PASS, 3/3.
- `npm run lint`: PASS; existing warnings are outside the modified files.
- `git diff --check`: PASS after removing trailing blank lines.
- Full 609-test Worker suite: NOT rerun locally; existing main PASS evidence was reused. The preceding PR head's full Worker CI had failures from missing synthetic Vendor master fixtures; the affected suites now pass locally, and the updated-head CI status is recorded on the PR. Wrangler local migration-engine integration: BLOCKED as described above.
- Formal migration version, deployed Worker behavior, and live formal APIs: NOT VERIFIED this turn; no production operation was attempted.

## Improvement / follow-up

| Recommendation | Priority | Status | Tracking | Acceptance |
| --- | --- | --- | --- | --- |
| Ship the 0019 identity fix as code without modifying formal D1 | P1 | This PR | Issues #104 and #139 | Reviewed squash merge; migration 0019 has no historical order backfill; 0020 and 0021 are non-destructive |
| Populate historical mappings only after exact menu-version evidence and authorized review | P1 | Later controlled data task; unresolved remains default | Issue #104 | Each mapping points to an exact menu version/date and reviewer; no name or alias inference |
| Resume formal release only after backup/restore and the remaining migration gates | P1 | Still open | Issues #104 and #139 | Separate approved release procedure and live API evidence; this PR is not a deployment |

## Prevention

- Trigger: any migration adds canonical identity to historical transactional records.
- Required guard: do not infer identity from labels; test pre-existing rows before/after migration, exact source linkage, unresolved behavior, Vendor cross-scope isolation, and settlement bounds using synthetic data; keep production migration and Worker release as separate gated actions.

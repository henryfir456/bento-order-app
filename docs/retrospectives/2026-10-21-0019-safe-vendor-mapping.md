# 2026-10-21 — 0019 safe canonical Vendor mapping

- Repository, branch, PR, commit: `henryfir456/bento-order-app`; implementation branch and PR are being created from the latest verified `main`.
- Goal / changes: remove historical `orders.vendor` name/alias backfill; add explicit append-only mapping from exact `menu_version_id` and effective date to canonical `vendor_id`; use only fully resolved same-vendor order lines for Vendor reads and settlement capacity; have new Worker orders write canonical IDs directly.
- Delivery status: implementation and synthetic verification complete; independent review and merge pending. No formal D1, Worker, R2, payment, Cloudflare, or Windows executor operation was performed.

## Blockers and boundaries

| Observation / phase | Classification | Evidence | Attempt and result | Root cause |
| --- | --- | --- | --- | --- |
| Formal migration 0019 previously inferred order identity from display text | Data safety | Previous `0019_vendor_order_settlements.sql` updated existing `orders` using `orders.vendor` and an alias | Replaced with a nullable column plus immutable mapping/attribution logic; did not apply any migration remotely | Verified unsafe inference; historical labels do not prove a canonical Vendor identity |
| Existing environments may already have the earlier 0019 revision | Migration compatibility | Repository history contains the old trigger-based revision; formal D1 was last reported at 0014 in Issues #104/#139 | Added forward-only 0020 to drop the old name/alias triggers and replace the settlement capacity queries; it leaves every order row untouched | Verified migration compatibility requirement; no remote schema state was re-read this turn |
| Wrangler local migration-engine integration test | Local runner | An earlier `--local` attempt failed to spawn its runtime with `EPERM`; a single elevated local attempt produced proxy warnings and did not complete | Used in-memory SQLite migration tests and synthetic Worker/API tests; did not retry Wrangler | Runner/proxy environment is the observed blocker; no evidence of a Cloudflare or production failure |
| Formal rollout and live API acceptance | Explicitly out of scope | User prohibited formal D1 modification and Worker deployment | No Cloudflare or Windows executor calls; no remote migration, payment, or API operation | Not performed by design; local results are not formal deployment evidence |

## Privacy publication check

- PII_SCAN: PASS after scanning the complete changed diff and new files; fixtures and explanations use synthetic data only.
- No real account, order, payment, employee, phone, LINE, credential, or production-row values were added.
- Issue and PR updates will describe only the code-level migration fix and remaining formal-release gates.

## Verification

- TDD: synthetic migration and Vendor-scope tests first exposed the historical text backfill / missing attribution behavior; updated tests now prove the safe schema and API behavior.
- `node tests/formal-schema.test.js` (`worker-poc/`): PASS, 24/24. Covers 0019 keeping historical rows unchanged/unmapped, mapping exact menu-version identity, latest revocation, append-only mapping, and old inferred IDs remaining outside Vendor scope until a reviewed mapping resolves them.
- `node tests/orders-create.test.js` (`worker-poc/`): PASS, 9/9. Covers canonical ID written by the server-side order path and immutable order assignment.
- `node tests/vendor-operations.test.js` (`worker-poc/`): PASS, 7/7. Covers Vendor A/B isolation, unmapped/mixed/mismatched/future history excluded, settlement capacity based only on attributable orders, and synthetic payment operations separate from the employee ledger.
- `node tests/vendor-rbac.test.js` (`worker-poc/`): PASS, 8/8.
- `node tests/runtime-config.test.js` (`worker-poc/`): PASS, 6/6; migration 0020 is in the formal migration chain.
- `node tests/formal-drift.test.js` (`worker-poc/`): PASS, 7/7.
- `node --test tests/changelog-migration.test.cjs` (repository root): PASS.
- `npm run lint`: PASS; existing warnings are outside the modified files.
- `git diff --check`: PASS after removing trailing blank lines.
- Full 609-test Worker suite: NOT RUN; existing unchanged evidence was reused. Wrangler local migration-engine integration: BLOCKED as described above.
- Formal migration version, deployed Worker behavior, and live formal APIs: NOT VERIFIED this turn; no production operation was attempted.

## Improvement / follow-up

| Recommendation | Priority | Status | Tracking | Acceptance |
| --- | --- | --- | --- | --- |
| Ship the 0019 identity fix as code without modifying formal D1 | P1 | This PR | Issues #104 and #139 | Reviewed squash merge; migration 0019 has no historical order backfill and 0020 is non-destructive |
| Populate historical mappings only after exact menu-version evidence and authorized review | P1 | Later controlled data task; unresolved remains default | Issue #104 | Each mapping points to an exact menu version/date and reviewer; no name or alias inference |
| Resume formal release only after backup/restore and the remaining migration gates | P1 | Still open | Issues #104 and #139 | Separate approved release procedure and live API evidence; this PR is not a deployment |

## Prevention

- Trigger: any migration adds canonical identity to historical transactional records.
- Required guard: do not infer identity from labels; test pre-existing rows before/after migration, exact source linkage, unresolved behavior, Vendor cross-scope isolation, and settlement bounds using synthetic data; keep production migration and Worker release as separate gated actions.

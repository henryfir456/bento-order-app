# 2026-10-21 — Isolated local Worker UAT for formal-release drift

- Repository / PR / commit: henryfir456/bento-order-app; branch is created from current main after local verification. PR URL and exact reviewed head will be added after GitHub creation.
- Goal / changes: provide a runnable, isolated Worker + D1 alternative after the Cloudflare connector's previously reported internal error. Added synthetic local login, Admin/User/Vendor fixtures, all local schema migrations through 0019, Windows start/stop scripts, a real HTTP acceptance runner, and a development-only frontend login.
- Delivery status: PARTIAL pending PR review and merge. The local Worker and D1 were exercised over HTTP; the Cloudflare test Worker and formal Worker were not deployed.

## Blockers

| Observation / stage | Category | Evidence | Attempt and result | Root cause |
| --- | --- | --- | --- | --- |
| Cloudflare control plane | External environment | Cloudflare connector previously returned an internal error; current task explicitly required switching to the local fallback on this condition | Did not retry the same Cloudflare request. Built and ran the complete Worker locally against disposable D1 | Previously observed connector failure; remote Cloudflare state remains NOT VERIFIED |
| Public URL and real Android handset | Device / network | This execution environment has no Windows host or connected Android device, and its network policy does not provide a public port forward | Windows launcher binds only to loopback. It can forward the two local ports to one USB-connected Android device with ADB reverse | User-side Windows / handset operation remains HUMAN_TEST_PENDING |
| Formal deployment | Formal data / release gate | Current #104 and #139 records state formal migration and backup gates remain unresolved; the current task prohibits changing production data | No formal D1, Worker, secrets, cron, R2, or payment endpoint was accessed | Formal release remains NOT DEPLOYED and separate from local UAT |

## Local isolation and privacy

- The test config names only bento-order-app-local-uat-only, uses a local sentinel D1 identifier, and binds no R2, KV, queue, Durable Object, service, or cron resource. Wrangler always runs with --local; its child environment strips all CLOUDFLARE_ and CF_ environment variables. Explicit local CORS does not allow the formal frontend origin.
- Migrations 0000–0019 were applied to a newly reset disposable local D1. Migration 0017 received one explicit synthetic protected-account owner mapping. Migration 0019 ran before any fixture orders existed; the only orders added afterward are synthetic.
- Four synthetic login roles are generated with random local passwords. Passwords and the signing key are stored only under ignored worker-poc/.local-uat/ files. They are not printed in test output or committed.
- A single synthetic transfer row is seeded for settlement readback. No payment or transfer write endpoint was called.
- PII_SCAN on all new files and added diff lines: PASS. worker-poc/.local-uat/ is ignored by Git.

## Verification

- node scripts/local-uat.mjs reset from worker-poc: PASS, exit 0. It verified migration 0019, exact synthetic fixture counts, and an empty foreign-key check.
- Wrangler local Worker: started with the isolated config and bound to 127.0.0.1:8787; /api/health returned HTTP 200 with the local D1 available.
- node scripts/local-uat-smoke.mjs http://127.0.0.1:8787: PASS, 21 actual HTTP/API checks. Announcement list/unread/read/dismiss: 200. Admin vendor catalog: 200. Each synthetic Vendor sees only its own orders: 200; a cross-vendor request: 403 VENDOR_SCOPE_FORBIDDEN. Admin settlement query: 200 with the synthetic seeded transfer; Vendor attempt to use the Admin endpoint: 403. All/year/month statistics: 200; each reports 21 portions and 4 identities, with the same-name, different-identity case kept separate. The local Worker denies CORS access to the formal frontend origin. Payment write calls: zero.
- Vite local development endpoint: HTTP 200 at http://127.0.0.1:5173/. The Windows launcher presents http://localhost:5173 and http://localhost:8787, writes credentials locally, and configures USB ADB forwarding when exactly one device is connected.
- npm run test:local-uat (root): PASS; npm run test:local-uat --prefix worker-poc: PASS.
- node tests/cors.test.js from worker-poc: PASS, 40/40. A new regression first failed because local CORS inherited the production frontend origin, then passed after local mode was limited to local origins and explicit local allowlist entries.
- npm run build: PASS; Vite emits the repository's existing large-chunk advisory.
- The main SHA's existing 609 Worker tests remain valid and were not rerun; this change adds one focused local Worker test.
- Required Checks / GitHub Actions were not used to deploy anything. Physical Windows, Android UI interaction, Cloudflare test Worker, and formal API acceptance are NOT VERIFIED.

## Follow-up

| Recommendation | Priority | Disposition | Tracking | Acceptance |
| --- | --- | --- | --- | --- |
| Run the local launcher on Windows and verify the front-end login with USB-connected Android | P2 | Human device acceptance remains | #104 and #139 | User opens the printed local URL, signs in with the generated role/password file, and can switch roles |
| Keep formal Worker/D1 drift visibly separate from local UAT | P1 | Update existing issues | #104 and #139 | Issue text distinguishes local API PASS from formal NOT DEPLOYED; no migration or formal payment write is claimed |

## Next-run prevention

- Trigger: Cloudflare deployment access is unavailable while local validation can still proceed.
- Add a bounded decision point: after one observed Cloudflare connector failure, use only the disposable local Wrangler + D1 path; bind loopback, generate local credentials, test real HTTP contracts, and never label a local result as a Cloudflare or formal deployment.

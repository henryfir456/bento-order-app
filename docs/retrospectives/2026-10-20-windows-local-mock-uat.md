# 2026-10-20 — Windows local Mock integration UAT package

- Repository: `henryfir456/bento-order-app`.
- Base: current `main` `8c87e347d81ee8fa191fed6fd4ab3169df6521d6`.
- Package version: `0.17.3`.
- Scope: prepare one Windows local UAT entry for #121/#122/#123/#124/#125/#128. No Worker source, migration, formal data, or production account was changed.
- Changed behavior: when the DEV-only Mock adapter receives browser `localStorage`, it persists only synthetic Vendor payment entries under `bento-mock-vendor-payments-v1`. A test `Storage` stub models reading the serialized fixture into a new adapter for another `VITE_MOCK_USER`; saved data is shape-checked and malformed entries are ignored. Storage failure leaves the in-memory Mock usable. The Admin Mock transfer form now labels its confirmation, values, and action as synthetic, so local testing does not ask the operator to assert a real bank transfer.
- Documentation: `docs/UAT_WINDOWS_LOCAL_MOCK_INTEGRATION.md` combines the six requested issues, Windows commands, safe `.env.local` setup, same-origin role switching, reset command, and API/identity boundary. `docs/UAT_WINDOWS_ISSUES_103_108_111.md` links to the combined entry and no longer overwrites `.env.local`.

## Findings and fixes

| Finding | Evidence | Resolution |
| --- | --- | --- |
| Existing Windows steps used `Copy-Item -Force`, which could overwrite a user's local settings. | Existing #103/#108/#111 runbook. | Copy the mock example only when `.env.local` does not already exist, then set only this PowerShell session's Vite environment. |
| `dev-start.ps1`/`.bat` starts a public tunnel and changes the LIFF endpoint. | Existing script behavior. | The combined runbook uses the local Vite command and explicitly excludes the tunnel script. |
| Mock role was fixed at Vite startup, while the transfer store was process memory; a restart between Admin and Vendor erased the payment. | `authMode.js` reads `VITE_MOCK_USER` at startup; `mockData.js` previously initialized an empty module store. | Persist only synthetic payment entries to same-origin local storage and add a restart/role-switch regression test. |
| The first full responsive UAT after adding persistence failed its second viewport's zero-transfer assertion. | The same browser profile tested 375px and 1280px in sequence; the first viewport's intentionally persisted test payment remained visible on the second pass. | Clear only the synthetic payment key before the second viewport navigation; the full UI suite then passed on rerun. |
| Admin's local Mock form asked the operator to confirm a real bank-app transfer. | `VendorOperationsPage.jsx` showed the production prompt even when `mock=true`. | Show an explicit LOCAL MOCK simulation prompt and synthetic-only action text under Mock. |
| A static ZIP cannot safely exercise this flow because Mock requires Vite `DEV`; building or previewing a production bundle intentionally disables Mock. | `authMode.js` gate: `import.meta.env.DEV && VITE_AUTH_MODE === 'mock'`. | Provide checked-in Windows runbook commands; do not publish a misleading static Mock build to Library. |
| The first PR revision described the adapter persistence test as a real browser/Vite restart. | Independent review found the test uses an injected `Storage` stub and a new Mock adapter instance; it does not restart Vite or reload browser `localStorage`. | Correct the runbook and this evidence record to identify it as adapter-level persistence coverage; keep the actual role-switch restart as manual local-browser UAT. |

## Verification

- `node --test tests/strict-identity-ledger.test.cjs tests/changelog-migration.test.cjs tests/pii-scan-public-artifacts.test.cjs`: PASS, exit 0; 93 passed, 3 skipped, 0 failed.
- `node worker-poc/tests/invalid-employee-repair.test.js && node worker-poc/tests/effective-order-item-name.test.js && node worker-poc/tests/line-binding-transfer.test.js && node worker-poc/tests/roles.test.js`: PASS, exit 0; 39 passed, 0 failed.
- `npm test --prefix worker-poc`: PASS, exit 0; 599 passed, 0 failed, including protected-account and Vendor operations/RBAC contracts.
- Manifest UI suite (`node --test tests/invalid-employee-repair-ui.test.cjs tests/effective-order-item-name-ui.test.cjs tests/line-binding-transfer-ui.test.cjs tests/order-statistics-ui.test.cjs tests/announcement-images-ui.test.cjs tests/vendor-operations-ui.test.cjs tests/local-mock-responsive-uat.test.cjs`): PASS, exit 0; 37 passed, 0 failed. Includes 320px, 375px, 1280px browser coverage and an adapter-level synthetic Admin/Vendor persistence contract; it does not prove a browser restart. Its first post-persistence run had one second-viewport fixture carryover failure; clearing the mock payment key before that new viewport/page fixed the test and the rerun passed.
- `node --test tests/vendor-operations-ui.test.cjs`: PASS, exit 0; 7 passed, 0 failed. Includes transfer save, a new adapter reading from an injected test `Storage` stub, Vendor acknowledgment, Admin readback, and malformed-owner rejection. Actual Vite/browser restart remains manual UAT.
- `npm run lint`: PASS, exit 0; existing repository warnings remain, with none reported in the changed runtime files.
- `npm run build`: PASS, exit 0; Vite reports an 801.43 kB minified JS chunk above its 500 kB advisory threshold.
- `git diff --check origin/main`: PASS, exit 0.
- `git diff --unified=0 origin/main | node scripts/pii-scan-public-artifacts.mjs --diff-stdin`: PASS. `git ls-files --others --exclude-standard | xargs -r node scripts/pii-scan-public-artifacts.mjs`: PASS for both new documents. An initial scan caught a numeric-length literal and full source SHA in authored text; these were shortened without weakening the scanner.
- `git diff --quiet 42eb9ab origin/main -- worker-poc` and `git diff --quiet origin/main HEAD -- worker-poc`: PASS, no Worker subtree difference at the verified base or in this task.
- Mock UI evidence remains separate from remote Worker/API, LINE identity, D1, and bank evidence. The bounded UAT Worker HTTP probes previously failed before receiving a Worker response (`EAI_AGAIN` / proxy HTTPS CONNECT `403`); remote health and authenticated acceptance remain `NOT VERIFIED`.

## Remaining boundary

- GitHub currently lists #121/#122/#128 closed and #123/#124/#125 open. Local Mock provides synthetic UI evidence; it does not close their broader runtime/data/identity acceptance requirements.
- The deployed UAT Worker was built from source commit `42eb9ab`; `worker-poc/` had no source diff against base main or this branch. This change does not modify that subtree or deploy anything.
- No production Worker deployment, formal D1 migration, real identity/login, real payment, D1 data repair/export, or Library upload was performed.

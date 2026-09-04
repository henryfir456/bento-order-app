# Frontend and GAS Domain Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the existing frontend and Google Apps Script code by domain while preserving every existing UI behavior, API contract, permission rule, View As rule, Sheet schema, and business calculation.

**Architecture:** Keep `src/App.jsx` as the owner of bootstrap, authenticated identity, View As identity, top-level navigation, shared state, and cross-domain orchestration. Extract only pure permission/configuration, a thin fetch wrapper, and presentational/domain sections with explicit props. Move the existing GAS function bodies unchanged from `src/code.gs` into a `gas/` directory whose files share Apps Script global scope; leave `gas/Code.gs` as the HTTP router and access-token adapters.

**Tech Stack:** React 19, Vite, native `fetch`, LINE LIFF, Google Apps Script global-scope `.gs` files, Node `node:test`-style regression tests, Oxlint.

**Spec:** `C:\Users\SER\.codex\attachments\a632577f-792d-4550-b790-847a34130fd7\pasted-text.txt`

## Global Constraints

- `zero behavior change`
- `不新增功能`
- `不改 business rule`
- `不改 API contract，除非只是 import/path 調整所必需`
- `不改 Sheet schema`
- `不改 LINE login / identity model`
- `不改 permission semantics`
- `不改 View As semantics`
- `不改訂單 / 扣款 / 儲值 / 月曆 / 店家模式 / deadline 邏輯`
- `不 deploy`
- `不 commit`
- `不 push`
- Preserve existing working-tree changes and do not alter unrelated files.
- Do not add `appsscript.json` or `.clasp.json`; inspection found no existing deployment manifest or single-file deploy pipeline.

---

### Task 1: Freeze the source map and test loader contract

**Files:**
- Create: `docs/superpowers/plans/2026-09-04-frontend-gas-domain-refactor.md`
- Modify: `tests/strict-identity-ledger.test.cjs:loadGas`
- Test: `tests/strict-identity-ledger.test.cjs`

**Interfaces:**
- Consumes: the existing `vm`-based `loadGas()` test context and current `src/code.gs` function names.
- Produces: a deterministic `loadGasSources()` list for the future files, in this order: `Utils.gs`, `Permissions.gs`, `Auth.gs`, `Users.gs`, `Orders.gs`, `Balances.gs`, `Calendar.gs`, `Admin.gs`, `Code.gs`.

- [x] **Step 1: Record the pre-refactor source boundaries**

  Confirm with `Get-Content ... | Measure-Object -Line` and `rg -n '^function |^const '` that `src/App.jsx` is 2,046 lines, `src/code.gs` is 1,472 lines, and the tests read `src/code.gs` directly.

- [x] **Step 2: Keep the current regression suite as the behavior oracle**

  Do not rewrite assertions or expected response shapes. Only replace the single source read with the ordered multi-file loader after the new files exist.

- [x] **Step 3: Run the baseline suite**

  Run `node --test tests/strict-identity-ledger.test.cjs` and record the result before moving code.

---

### Task 2: Split GAS shared definitions and HTTP entry points

**Files:**
- Create: `gas/Utils.gs`
- Create: `gas/Permissions.gs`
- Create: `gas/Code.gs`
- Modify: `tests/strict-identity-ledger.test.cjs:loadGas`
- Delete: `src/code.gs` after the complete split is verified

**Interfaces:**
- `Utils.gs` produces the shared constants `TIMEZONE`, `USERS_SHEET`, `ORDERS_SHEET`, `BALANCE_LEDGER_SHEET`, `VALID_PICKUP_FLOORS`, `UNREGISTERED_USER_MESSAGE`, plus `normalizeOrderDate`, `isValidYearMonth`, `isValidDateString`, `ledgerTimestampKey`, `hasNumericValue`, and `jsonResponse`.
- `Permissions.gs` produces the unchanged `ROLE_PERMISSIONS` object and `hasPermission(role, permission)`.
- `Code.gs` produces unchanged `doGet(e)`, `doPost(e)`, and access-token adapter functions: `submitOrderForAccessToken`, `cancelOrderForAccessToken`, `toggleLikeForAccessToken`, `adminSetVendorForAccessToken`, `assignProxyForAccessToken`, `topUpBalanceForAccessToken`, `getAdminSummaryForAccessToken`, `getBalanceHistoryByMonthForAccessToken`, and `getMemberBalancesForAccessToken`.

- [x] **Step 1: Create `Utils.gs` and `Permissions.gs` by exact source extraction**

  Move the existing declarations and function bodies without changing comparisons, return values, error strings, or payload names. Keep each global declaration defined exactly once.

- [x] **Step 2: Create `Code.gs` with only the existing router and adapters**

  Keep the existing `doGet` branch names and `doPost` action names byte-for-byte in meaning. The adapters must continue to resolve the LINE access token through `getAuthenticatedUser()` before calling domain functions.

- [x] **Step 3: Update the test loader and run the regression suite**

  Load the nine files in the order defined above, then run `node --test tests/strict-identity-ledger.test.cjs`. Expected: all existing tests pass before any domain file is moved.

---

### Task 3: Move GAS identity and user domain bodies

**Files:**
- Create: `gas/Auth.gs`
- Create: `gas/Users.gs`
- Modify: `tests/strict-identity-ledger.test.cjs:loadGas`

**Interfaces:**
- `Auth.gs` owns `LINE_PROFILE_URL`, `identityError`, `safeErrorText`, `logIdentityException`, `isIdentityAction`, `getLineProfile`, `getAuthenticatedUser`, `getUserInfo`, and `registerUser`.
- `Users.gs` owns `getRegisteredUser`, `getIdentityError`, `isValidPickupFloor`, `isAdminUser`, `toPublicUser`, and `getAllUserSummaries`.

- [x] **Step 1: Move identity functions without changing authentication flow**

  Preserve access-token redaction, LINE Profile HTTP status mapping, registration idempotency, and canonical profile-derived name/user ID handling.

- [x] **Step 2: Move Users sheet lookups and summaries**

  Preserve Users column indexes, default role behavior, balance coercion, and public user fields.

- [x] **Step 3: Run focused identity and permission tests**

  Run `node --test tests/strict-identity-ledger.test.cjs --test-name-pattern="LINE|identity|registration|permission|forged"`. Expected: PASS with unchanged response objects and error codes.

---

### Task 4: Move GAS order, balance, calendar, and admin domains

**Files:**
- Create: `gas/Orders.gs`
- Create: `gas/Balances.gs`
- Create: `gas/Calendar.gs`
- Create: `gas/Admin.gs`
- Modify: `tests/strict-identity-ledger.test.cjs:loadGas`

**Interfaces:**
- `Orders.gs` owns `getOrderPageData`, `getUserOrder`, `getUserAllOrdersMap`, `getAdminOrders`, `submitOrder`, `generateOrderId`, and `cancelOrder`.
- `Balances.gs` owns `getUserCurrentBalance`, `applyBalanceChange`, `ensureTopupHistorySchema`, `inferLegacyLedgerType`, `appendBalanceLedger`, `getBalanceHistory`, `getBalanceHistoryByMonth`, `auditBalanceConsistency`, `getMemberBalances`, and `topUpBalance`.
- `Calendar.gs` owns lunar/date deadline helpers and `getCalendarEvents`, `toggleLike`, `adminSetVendor`, and `getInitData`.
- `Admin.gs` owns `getAdminSummary` and `assignProxy`.

- [x] **Step 1: Extract Orders.gs and run order tests**

  Preserve lock acquisition, deadline checks, ACTIVE/CANCELLED transitions, OrderID generation, refund/charge ledger sequencing, and existing order row layout.

  Run `node --test tests/strict-identity-ledger.test.cjs --test-name-pattern="order|deadline|calendar management"`. Expected: PASS.

- [x] **Step 2: Extract Balances.gs and run ledger tests**

  Preserve Users balance as the canonical balance, append-only ledger writes, legacy metadata backfill, monthly opening/closing reconstruction, and permission gates.

  Run `node --test tests/strict-identity-ledger.test.cjs --test-name-pattern="balance|ledger|top-up|monthly|reconciliation"`. Expected: PASS.

- [x] **Step 3: Extract Calendar.gs and Admin.gs and run all GAS tests**

  Preserve vendor/mode fallback, weekend/special-date behavior, likes business rule, selected-date summaries, ProxyAdmin permissions, and all existing API shapes.

  Run `node --test tests/strict-identity-ledger.test.cjs`. Expected: PASS.

- [x] **Step 4: Remove `src/code.gs` only after the multi-file loader passes**

  Verify no test, Vite config, README, or deployment file references `src/code.gs`. The production GAS runtime must see every function once across `gas/*.gs`.

---

### Task 5: Extract frontend permission/configuration and API transport

**Files:**
- Create: `src/auth/permissions.js`
- Create: `src/api/gasApi.js`
- Modify: `src/App.jsx`
- Modify: `tests/strict-identity-ledger.test.cjs` frontend structural assertions

**Interfaces:**
- `src/auth/permissions.js` exports `ROLE_PERMISSIONS` and `hasPermission(role, permission)` with the exact current permission mapping.
- `src/api/gasApi.js` exports `gasGet(query)` and `gasPost(payload)`; `gasPost` must use the current `Content-Type: text/plain` and JSON body, while `gasGet` must preserve the existing URL query strings and cache-busting parameters.

- [x] **Step 1: Move the permission map without changing semantics**

  Replace the in-file definitions with `import { hasPermission } from './auth/permissions';`. Keep `can` and `canAuth` in `App.jsx` so effective-role and authenticated-role ownership stays unchanged.

- [x] **Step 2: Add the thin API wrapper**

  Implement only transport reuse:

  ```js
  const GAS_API_URL = import.meta.env.VITE_GAS_API_URL;

  export const gasGet = (query) => fetch(`${GAS_API_URL}${query}`);

  export const gasPost = (payload) => fetch(GAS_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify(payload)
  });
  ```

- [x] **Step 3: Replace only equivalent fetch call sites**

  Change `fetch(GAS_API_URL, { ... })` to `gasPost({ ... })` and `fetch(`${GAS_API_URL}? ...`)` to `gasGet('? ...')`, keeping every payload field and every response/error branch unchanged.

- [x] **Step 4: Run lint, build, and frontend regression tests**

  Run `node --test tests/strict-identity-ledger.test.cjs`, `npm run lint`, and `npm run build`. Expected: existing warnings may remain, but no new error or warning class is introduced.

---

### Task 6: Extract small frontend presentational/domain sections

**Files:**
- Create: `src/components/ViewAsBanner.jsx`
- Create: `src/features/calendar/CalendarManagement.jsx`
- Create: `src/features/orders/OrderPage.jsx`
- Create: `src/features/admin/AdminOrderSummary.jsx`
- Create: `src/features/balances/MemberBalanceManagement.jsx`
- Create: `src/features/balances/formatters.js`
- Modify: `src/App.jsx`
- Modify: `tests/strict-identity-ledger.test.cjs` frontend structural assertions

**Interfaces:**
- Components are presentational and receive state/handlers via props; none owns `authUser`, `viewAsUser`, `selectedDate`, order state, member balance state, or API calls.
- `ViewAsBanner` consumes `{ viewAsUser, displayBalance, onExit }`.
- `CalendarManagement` consumes current month, admin-calendar state, calendar nodes/weekend nodes, and existing callbacks.
- `OrderPage` consumes the existing selected date, setting/deadline, grouped menu, order state setters, image error state, and view-only flags.
- `AdminOrderSummary` consumes selected date, summary data, loading/error state, aggregated order data, and the existing date-change callback.
- `MemberBalanceManagement` consumes member rows, loading/error state, `canTopup`, and the existing top-up opener.

- [x] **Step 1: Extract ViewAsBanner from the header**

  Move only the existing preview-balance and “返回 Admin” markup. Keep `handleExitViewAs` and all View As state in `App.jsx`.

- [x] **Step 2: Extract calendar and order sections**

  Move the existing JSX with no condition or handler changes. Pass `renderCalendarDays()` and `renderWeekendEvents()` results as props so date calculation and canonical state remain in `App.jsx`.

- [x] **Step 3: Extract admin summary and member balance sections**

  Move the existing conditional markup exactly, including empty/loading/error states, role visibility, and top-up button conditions.

- [x] **Step 4: Move balance display formatters**

  Export the current `formatSignedAmount` and `formatBalanceAmount` implementations from `src/features/balances/formatters.js`; do not alter numeric coercion or sign formatting.

- [x] **Step 5: Run frontend checks after each component extraction**

  After each extraction run `npm run lint && npm run build`; after all extractions run `node --test tests/strict-identity-ledger.test.cjs`.

---

### Task 7: Final structural and zero-behavior verification

**Files:**
- Modify: `tests/strict-identity-ledger.test.cjs` only if structural path assertions still reference moved files

**Interfaces:**
- The final test loader reads `gas/*.gs`; frontend structural assertions read the extracted permission module and verify `App.jsx` still owns auth/view-as/effective state.

- [x] **Step 1: Run the complete automated checks**

  Run:

  ```powershell
  node --test tests/strict-identity-ledger.test.cjs
  npm run lint
  npm run build
  git diff --check
  ```

- [x] **Step 2: Run static path and duplicate checks**

  Confirm with `rg` that there is no production reference to `src/code.gs`, only one frontend permission map, no duplicate GAS global declarations, and no dead imports.

- [x] **Step 3: Review the diff for behavior changes**

  Search the diff for changed `if` conditions, comparisons, return objects, API payload keys, error codes, Sheet ranges, permission mappings, deadline code, and balance/price expressions. Any such change must be reverted to exact source movement unless required solely by an import/path update.

- [x] **Step 4: Report final architecture and limitations**

  Report before/after file structure, App.jsx and GAS line counts, all created/moved/deleted files, test/lint/build results, `git diff --check`, `git status --short`, unchanged behavior/API contract, and remaining tech debt. Do not commit, push, deploy, run `clasp push`, or run Netlify deploy.

---

## Risk Controls and Expected Non-Goals

- Apps Script files share global scope, so every `const` and function name must remain unique; no production behavior depends on file order.
- The Node VM loader has a deliberate order for test initialization only; Apps Script production execution still resolves globals after all files are loaded.
- `App.jsx` remains intentionally orchestration-heavy where handlers couple auth, View As, navigation, and domain state. The refactor does not introduce Context, Redux, Router, a new UI library, or hooks solely to reduce line count.
- Real-device LINE login and Google Sheets runtime behavior are not available in this local verification pass; automated contract tests, lint, build, and static diff review are the evidence for this refactor.

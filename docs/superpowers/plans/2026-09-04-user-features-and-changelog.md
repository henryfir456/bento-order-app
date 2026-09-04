# User Features and Changelog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add authenticated default-floor editing, corrected ProxyAdmin finance permissions, a package-version changelog footer, and accessible menu-image previews without changing existing ordering or balance business rules.

**Architecture:** Keep App.jsx as the owner of authenticated/effective identity, modal state, and API orchestration. Add one small reusable Modal, one structured changelog data source that imports `package.json.version`, and one token-authenticated GAS endpoint that updates only the Users canonical floor column. Keep order item calculations and existing per-order floor state separate from the account default floor.

**Tech Stack:** React 19, Vite, Tailwind utility classes, SweetAlert2, Google Apps Script V8, Node `node:test`.

**Spec:** `C:\Users\SER\.codex\attachments\ca2f8272-fcff-4020-9ae5-e5b5ba1ca694\pasted-text.txt`

## Global Constraints

- Set `package.json` version to `0.6.0`.
- Use the approved git-derived public history: `0.1.0`, `0.2.1`, `0.3.0`, `0.4.0`, `0.4.1`, `0.5.0`, `0.6.0`; do not display commit hashes in the UI.
- Do not change Sheet schema, LINE login/identity model, order/price/charge/refund/deadline/vendor logic, or historical order rows.
- Do not add a UI library, lightbox library, backend changelog API, or duplicated version source.
- Do not commit, push, deploy, run `clasp push`, or run Netlify deploy.

---

### Task 1: Version source and shared modal

**Files:**
- Modify: `package.json`
- Create: `src/data/changelog.js`
- Create: `src/components/Modal.jsx`
- Modify: `src/App.jsx`
- Test: `tests/strict-identity-ledger.test.cjs`

**Interfaces:**
- `src/data/changelog.js` exports `APP_VERSION` and `CHANGELOG`; `APP_VERSION` is read from `package.json`, and `CHANGELOG` is newest-first with versions, dates, user-facing changes, and non-UI `commits` traceability fields.
- `Modal` accepts `{ open, title, onClose, children, ariaLabel, className }`, closes from overlay, close button, and Escape, and locks body scrolling while open.

- [x] **Step 1: Add failing structural assertions**

  Assert `package.json` has version `0.6.0`, the changelog exports the approved release sequence plus the new `0.6.0` entry, and App imports both `APP_VERSION` and `CHANGELOG`.

- [x] **Step 2: Implement the single version/changelog source**

  Import `package.json` in `src/data/changelog.js`; export its version as `APP_VERSION`. Store the approved historical releases using the approved release text and commit hashes, then add `0.6.0` dated `2026-09-04` with this round's four user-facing changes. Keep `commits` in the data for developer traceability but do not render it.

- [x] **Step 3: Implement the small accessible Modal**

  Render nothing when closed; otherwise render an overlay, a dialog with `role="dialog"`, `aria-modal="true"`, optional title, keyboard Escape handling, overlay-background close only, and a keyboard-accessible close button. Restore the previous body overflow on cleanup.

- [x] **Step 4: Add the non-fixed footer and changelog dialog**

  Make the page shell a vertical layout, add a footer after the main content with a low-emphasis `v{APP_VERSION}` button on the right, and render `CHANGELOG` newest-first in `Modal`. Keep the existing order action bar unchanged.

- [x] **Step 5: Run focused frontend checks**

  Run `node --test tests/strict-identity-ledger.test.cjs --test-name-pattern="frontend|version|changelog|modal"`, `npm run lint`, and `npm run build`.

### Task 2: Authenticated default pickup floor

**Files:**
- Modify: `gas/Users.gs`
- Modify: `gas/Code.gs`
- Modify: `src/App.jsx`
- Modify: `tests/strict-identity-ledger.test.cjs`

**Interfaces:**
- GAS action: `updateMyPickupFloor` with `{ action, accessToken, pickupFloor }`.
- GAS adapter: `updateMyPickupFloorForAccessToken(data)` authenticates through `getAuthenticatedUser(data.accessToken)` and calls `updateMyPickupFloor(authenticated.user.userId, data.pickupFloor)`.
- Domain function: `updateMyPickupFloor(userId, pickupFloor)` validates `1樓`/`9樓`, locks the script, writes Users column 3, and returns `{ success: true, user: toPublicUser(updatedUser) }`.

- [x] **Step 1: Add failing backend contract tests**

  Cover valid 1樓/9樓 updates, invalid floors, forged client user IDs being ignored, unknown token users being rejected, and unchanged Orders rows.

- [x] **Step 2: Implement the token-authenticated Users update**

  Add only the new doPost route, adapter, and Users-column update. Use the existing `VALID_PICKUP_FLOORS`, `getRegisteredUser`, `LockService`, and `toPublicUser`; never trust a client-supplied user ID.

- [x] **Step 3: Add App floor modal state and handlers**

  Add draft/loading/error state. Open only for the authenticated real user when registered and not in View As. On success update `authUser`, `defaultFloor`, and header-derived values from the returned canonical user; do not overwrite the current order's `floor` state. On failure leave the canonical UI value unchanged.

- [x] **Step 4: Render the clickable floor badge**

  Replace `預設領取：{displayFloor}` with an accessible button badge showing only `1樓`/`9樓`. Disable/hide it in View As, show saving/error states in the Modal, and close only after successful save.

- [x] **Step 5: Run floor and regression tests**

  Run `node --test tests/strict-identity-ledger.test.cjs --test-name-pattern="floor|identity|order|View As"`, then the full test suite.

### Task 3: Remove ProxyAdmin finance access

**Files:**
- Modify: `src/auth/permissions.js`
- Modify: `gas/Permissions.gs`
- Modify: `tests/strict-identity-ledger.test.cjs`

**Interfaces:**
- `ProxyAdmin.viewMemberBalances === false` and `ProxyAdmin.topupMember === false` in both permission definitions.
- Admin retains both permissions; User remains denied.

- [x] **Step 1: Update permission contract tests**

  Assert both frontend and GAS maps deny the two finance permissions for ProxyAdmin and User, retain them for Admin, and retain ProxyAdmin order-summary, all-orders, and statistics permissions.

- [x] **Step 2: Change both centralized permission maps**

  Change only the two ProxyAdmin values to `false`; leave all other role entries unchanged. Existing App section guards and GAS `getMemberBalances`/`topUpBalance` gates must then enforce the new result.

- [x] **Step 3: Run permission tests**

  Run `node --test tests/strict-identity-ledger.test.cjs --test-name-pattern="permission|ProxyAdmin|member balance|top-up"` and verify the full suite afterward.

### Task 4: Menu image enlargement and preview

**Files:**
- Modify: `src/features/orders/OrderPage.jsx`
- Modify: `src/App.jsx`
- Modify: `tests/strict-identity-ledger.test.cjs`

**Interfaces:**
- `OrderPage` adds `onImagePreview(imageUrl, alt)` and keeps image errors keyed by the existing group name.
- App owns `imagePreview` state and passes the callback; the preview uses the shared Modal and original image URL.

- [ ] **Step 1: Add structural image-preview assertions**

  Assert image URLs render through an accessible button only when available, fallback remains non-clickable, preview state exists in App, and `OrderPage` receives an image-preview callback.

- [x] **Step 2: Enlarge the existing thumbnail safely**

  Keep the group-level image association and `object-cover`; use approximately `w-20 h-20 sm:w-24 sm:h-24` with `shrink-0`, preserve the fallback branch, and keep quantity controls outside the image button.

- [x] **Step 3: Add the preview Modal**

  Store only the selected image URL/alt in App, open it from the image button, render a larger responsive image, and rely on Modal overlay/X/Escape close. Do not add row-level click behavior or a new library.

- [x] **Step 4: Run image and regression checks**

  Run the focused frontend tests, `npm run lint`, and `npm run build`; verify no new lint warning class appears.

### Task 5: Final verification

**Files:**
- Modify: `tests/strict-identity-ledger.test.cjs` only for required structural assertions.

- [x] **Step 1: Run complete checks**

  Run:

  ```powershell
  node --test tests/strict-identity-ledger.test.cjs
  npm run lint
  npm run build
  git diff --check
  ```

- [x] **Step 2: Run static scope checks**

  Confirm no order/ledger/deadline API payloads changed, no client user ID is used by the floor update endpoint, no duplicate version source exists, no commit hashes render in UI, no ProxyAdmin finance access remains, and no image button contains quantity controls.

- [x] **Step 3: Report status**

  Report modified files, API contract addition, version/changelog source, image size before/after, test/lint/build/diff results, git status, and remaining runtime limitations. Do not commit or deploy.

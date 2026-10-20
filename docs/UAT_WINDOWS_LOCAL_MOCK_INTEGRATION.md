# Windows Local Integration UAT — Synthetic Mock

This runbook combines the local UI flows for Issues #121, #123–#125, and #128.
For the earlier #103/#108/#111 steps, see
[Windows Local UAT: Issues #103, #108, and #111](UAT_WINDOWS_ISSUES_103_108_111.md).
The frontend baseline is package version `0.17.3`; record the exact `main`
SHA used for each manual run with `git rev-parse HEAD`.

## Scope and safety

- This is a Vite **development-only Mock** using synthetic fixtures. It does
  not call the Worker, D1, GAS, LINE login, or a bank service. A static
  production build intentionally does not enable Mock mode.
- The Vendor payment fixture is synthetic. Its records live in the current
  browser origin's local storage so an Admin → Vendor → Admin role change can
  span a Vite restart. Ordinary Mock edits still reset on reload. Remove only
  `bento-mock-vendor-payments-v1` to reset the settlement fixture.
- Do not use `dev-start.ps1` or `dev-start.bat` for this run. They start a
  public tunnel and edit the LIFF endpoint; neither is needed for local Mock.
- Do not make a bank transfer. The Mock form is labeled as simulated and only
  writes the browser's synthetic fixture.

## Start on Windows

Use Node.js 24.x and PowerShell in a clean checkout of current `main`:

```powershell
git status --short
git fetch origin main
git switch main
git pull --ff-only origin main
git rev-parse HEAD
node --version
npm --version
if (-not (Test-Path .env.local)) { Copy-Item .env.uat-mock.example .env.local }
npm ci
$env:VITE_AUTH_MODE = 'mock'
$env:VITE_MOCK_USER = 'admin'
$env:VITE_API_TRANSPORT = ''
$env:VITE_GAS_API_URL = ''
$env:VITE_WORKER_API_URL = ''
$env:VITE_LIFF_ID = ''
npm run dev -- --host 127.0.0.1 --strictPort
```

The copy step leaves an existing `.env.local` untouched. The per-terminal
environment values select the synthetic account and prevent checked-in or
local endpoint settings from redirecting Mock requests. They do not change
Windows user or machine variables. Open `http://127.0.0.1:5173`; confirm the
header shows `DEV · MOCK ADMIN` before testing.

Keep this browser profile and origin (`http://127.0.0.1:5173`) for the full
settlement workflow. To switch roles, stop Vite with `Ctrl+C`, set the role in
the same PowerShell window, and restart the same command:

```powershell
$env:VITE_MOCK_USER = 'vendor'
npm run dev -- --host 127.0.0.1 --strictPort
```

Refresh the existing browser tab and confirm `DEV · MOCK VENDOR`. To return to
Admin, stop Vite, set `$env:VITE_MOCK_USER = 'admin'`, restart, and refresh the
same tab. To inspect the ordinary User shell, repeat with `user`. Switching to
a different port or browser profile uses a different local-storage origin and
will not share the synthetic payment fixture.

To clear only that fixture, open the browser developer console and run:

```js
localStorage.removeItem('bento-mock-vendor-payments-v1');
location.reload();
```

## Combined acceptance checklist

### #121 — Announcement inbox and entry popups

With the Admin Mock shell, confirm new synthetic notices appear one at a time
on entry, closing a notice does not silently suppress its next eligible
display, and the notification bell opens the unread list. Open the retained
legacy notice, return to the list, close it, and confirm the calendar/order
view remains in place. The existing local browser suite also exercises the
read state, popup preference, duplicate-resume guard, and narrow/desktop
layouts. This Mock cannot verify canonical-user preference persistence in D1.

### #122 — Reserved vendor LINE identity protection

This is **not a manual Mock acceptance item**. A synthetic Mock role cannot
prove ownership of the reserved LINE identity. The contract regression suite
is `worker-poc/tests/protected-account.test.js` and exercises synthetic owners,
unbound/dangling mappings, employee login, rebinding races, expired sessions,
identity repair, and View As denial against the Worker handler and isolated
SQLite database. Real LINE ownership and a current UAT mapping remain
`NOT VERIFIED`; do not use a real LINE account or ask for a token as part of
this local run.

### #123 — Admin and Vendor scope

Start as `admin`: open 管理 → 廠商每日訂單與轉帳對帳 and confirm the selector
contains both `Mock Bento A` and `Mock Bento B`. Switch to `vendor` as above.
Confirm the dedicated 廠商 shell shows only `Mock Bento A`, with no employee
balance, personal-order, footprint, or general Admin controls. This checks the
synthetic UI/adapter scope only; it is not the Worker membership or real
principal check.

### #124 — Vendor daily orders

As `vendor`, open 每日訂單與轉帳 and inspect the current-month synthetic day.
Expand it and check the displayed item quantities, amounts, cutoff label, and
settlement state. Confirm no employee name, employee number, or LINE identity
is shown. As `admin`, choose each Mock vendor and confirm the daily rows remain
vendor-scoped. The counts, prices, and service dates are fixture values, not
live orders or forecasts.

### #125 — Plan B manual transfer and optional Vendor response

1. As `admin`, open 管理 → 廠商每日訂單與轉帳對帳 and select `Mock Bento A`.
2. In `模擬登記銀行轉帳（LOCAL MOCK）`, enter a synthetic amount such as `100`
   and allocate `100` to the current service date. Check the two simulation
   confirmations and submit `登記合成轉帳與日期分攤`. No bank app or actual
   transfer is involved.
3. Verify the synthetic record shows `已登記轉帳・待廠商確認`; the remaining
   fixture difference stays separately visible.
4. Stop Vite, switch to `vendor`, restart on the same port, and refresh the same
   tab. Confirm the pending `Mock Bento A` payment survives the restart; choose
   `確認收到` and verify it moves to the confirmed total.
5. Switch back to `admin` the same way and confirm the updated state. For the
   alternate path, make another synthetic entry and use a non-empty test reason
   for `提出爭議`; switch back to Admin and record a synthetic resolution.

The page distinguishes receivable, registered transfer, unregistered
difference, pending confirmation, confirmed amount, and disputed amount. This
does not call a bank, assert bank receipt, write the employee balance ledger,
or test the remote append-only vendor ledger. The production UAT Worker API
and a real Vendor LINE principal are separate `NOT VERIFIED` gates.

### #128 — Responsive footprints donut

Use the Admin or User Mock account and open 足跡. Confirm the donut's center
total equals the sum of the shop rows, each row exposes counts and percentages,
and the long synthetic shop name remains readable without horizontal overflow.
Manually resize the browser to 320–375 px and then 1280 px. The automated local
browser test additionally checks the 320 px long-name case, phone layout, and
desktop layout.

## Automated evidence and external boundary

The browser regression entry points are
`tests/local-mock-responsive-uat.test.cjs` and
`tests/vendor-operations-ui.test.cjs`. They exercise local UI and viewport
behavior. The Vendor settlement persistence case in
`vendor-operations-ui.test.cjs` recreates the Mock adapter with an injected
test `Storage` stub, then verifies Vendor acknowledgment and Admin readback; it
does not restart Vite or reload browser `localStorage`. The Admin → Vendor →
Admin restart steps above remain manual local-browser acceptance. These
automated results are `MOCK_TEST_PASS`, not `INTEGRATION_TEST_PASS` for
Cloudflare.

The isolated Worker hostname can be assembled in PowerShell without copying
it from another source:

```powershell
$uatWorker = 'https://bento-order-app-uat-' + '2026' + '1019' + '.henryfir456.workers.dev'
```

It was deployed from source commit `42eb9ab`.
The Worker version is
`9be174b3-ce5f-45d4-b7b8-2c5e4480ba14`, deployment
`20f02a36-6bd4-46d9-8654-eec6bf0db3f5` at 100% of that UAT Worker. The
`worker-poc/` source tree was checked against main and had no code diff at this
baseline. Remote HTTP health, CORS, and authenticated Vendor API acceptance
remain `NOT VERIFIED`: the previous bounded probes failed before receiving a
Worker response (`EAI_AGAIN` / proxy HTTPS CONNECT `403`). Do not bypass that
network boundary.

No production Worker deployment, formal migration, D1 data repair, bank
transfer, or real-account operation is part of this runbook.

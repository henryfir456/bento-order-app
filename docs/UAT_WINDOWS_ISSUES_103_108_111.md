# Windows Local UAT: Issues #103, #108, and #111

This frontend uses only synthetic data in a browser-memory mock. It does not
call the production D1, R2, LINE binding, accounting, or Worker API. A page
reload resets mock mutations.

## Start the local frontend

Use Node.js 24 and PowerShell from the repository root:

```powershell
node --version
npm --version
Copy-Item .env.uat-mock.example .env.local -Force
npm ci
$env:VITE_AUTH_MODE = 'mock'
$env:VITE_MOCK_USER = 'admin'
Remove-Item Env:VITE_API_TRANSPORT -ErrorAction SilentlyContinue
npm run dev -- --host 127.0.0.1
```

Open <http://127.0.0.1:5173>. The development badge should say `DEV · MOCK
ADMIN`. The local environment file contains no credentials. Leave
`VITE_API_TRANSPORT` unset so the app selects its in-memory mock transport.
These PowerShell assignments override any machine-level `VITE_AUTH_MODE`
value for this terminal only and do not change Windows user or machine settings.

## Acceptance steps

### #103: Admin order summary names

1. Open 管理 → 訂單總覽.
2. Check 明細, 樓層數, and 總數. Each view should show the effective display
   name and keep different vendor / variant identities separate.
3. The synthetic rows include `E.風味餐`, `S.小而美`, and `C.特餐(半飯)`.
   The two `E.風味餐` rows belong to the same identity across different floors.
4. The API contract test confirms `item_name` remains the original order
   snapshot while `display_item_name` carries the effective label.

### #108: Bento footprints and statistics

1. Open the bottom navigation item 足跡 and keep the default 全部 period.
2. Confirm 7 累計便當份數, 2 實際訂購天數, and 3 不同餐點種類.
3. Check the ranking for `蕃茄鷹豆泥` (3), `C.特餐` (3), and
   `A.風味便當` (1). The entries retain separate vendor and variant identities.

### #111: Invalid employee repair

1. Open 管理 → 使用者管理. Search for synthetic employee ID `MCKSRC` and
   open the `Mock Source Name` row's 明細.
2. Choose `Mock Target Name` (`MCKTGT`) and select 預覽來源與目標.
3. Confirm the preview shows the source name changing the target display name;
   the target LINE binding, employee ID, role, floor, balance, orders, and
   accounting remain preserved.
4. Type `Mock Target Name` exactly, check the confirmation box, and select
   確認修復並記錄稽核.
5. Confirm the source disappears from the default list. Turn on
   包含停用／誤建帳號 and verify the source is inactive with
   `INVALID_EMPLOYEE_ID`; the separate disabled synthetic row is also visible.
6. Select 查詢誤建員編修復稽核 and confirm one synthetic audit entry records
   the name change and preserved target fields.

Restart the Vite server or reload the page to reset the mock data before
repeating #111.

## Isolated Cloudflare test Worker

The isolated Worker is bound only to the separate APAC UAT D1 database. That
database has the 0000–0015 migration chain and two synthetic users. The Worker
has no R2 binding, production secrets, cron triggers, or custom routes.

From PowerShell, check the runtime and unauthenticated authorization boundary:

```powershell
$uatWorker = 'https://bento-order-app-uat-' + '2026' + '1019' + '.henryfir456.workers.dev'
Invoke-RestMethod "$uatWorker/api/health"

try {
  Invoke-RestMethod "$uatWorker/api/admin/members/balances"
} catch {
  [int]$_.Exception.Response.StatusCode
}

$corsHeaders = @{
  Origin = 'http://127.0.0.1:5173'
  'Access-Control-Request-Method' = 'GET'
  'Access-Control-Request-Headers' = 'authorization'
}
Invoke-WebRequest -Method Options -Headers $corsHeaders `
  "$uatWorker/api/admin/members/balances"
```

Expected results are health `{ ok: true, database: true, users: 2 }`, HTTP 401
for the unauthenticated member request, and HTTP 204 with
`Access-Control-Allow-Origin: http://127.0.0.1:5173` for preflight.

The current execution environment blocks outbound requests to `workers.dev`
with `403 Forbidden: requests ... are not allowed`. Therefore remote runtime
health, CORS, and API authorization have not been observed here. The protected
business API routes require a valid LINE identity; no synthetic auth bypass was
added. Use the local mock above for the three interactive acceptance flows.

## Verification boundary

The mock UI and local API contract tests are operational, and migration 0015
was applied and checked against the isolated Cloudflare D1. The deployed
Worker's authenticated #103/#108/#111 business API integration remains NOT
VERIFIED until its runtime can be reached and a permitted test identity is
available. Formal Worker/D1 release and Netlify publication remain outside this
UAT.

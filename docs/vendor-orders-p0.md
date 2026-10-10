# Issue #36 — P0 feasibility and authorization decision

Evidence date: 2026-10-10. Repository base: `5dd8667360f522c012a338641bd7ec584dab1ef4`.
Delivery: staged Draft PRs only. No merge, deployment, remote migration, real order/payment, platform login, private endpoint discovery, merchant contact or credential acquisition is authorized here.

## Decision

**GO — internal centralized snapshots and MANUAL handoff.** A responsible organizer opens the official website, checks the current branch/menu/cart, and makes the final external decision personally. Internal handoff is not an external order. Subsequent entry is explicitly **人工回報 / MANUAL_REPORTED**, never platform-verified acceptance.

**NO-GO — MAIFOOD_OFFICIAL_API and browser-assisted submission.** Public material does not establish an authorized order-create interface for this app, order status/webhook contract, write sandbox, credentials, idempotency, commercial agreement or final-payment authority. This is insufficient evidence/authorization, not a claim that a partner API does not exist. A public ERP test host is not our order-writing sandbox permission. Adapter remains OFF and has no network submission implementation; an environment flag alone cannot enable it.

## Evidence and capability matrix

| Capability | Public evidence | What it proves / remaining gate |
| --- | --- | --- |
| Official ordering entry | [B1 official ordering instructions](https://vegetsai.com.tw/orderinfo.html), [B2 iMenu entry](https://imenu.com.tw/vegetsai/branches) | Official web ordering exists; current branch/menu/cart contents were not retrieved in this runtime. No authenticated interaction performed. |
| Delivery rules | B1 | Weekday delivery 11:00–13:00, ordinary order cutoff 10:30; free-delivery thresholds 300 within 5 km / 500 outside; below 300 may incur 30 fee, timing restrictions and merchant discretion. Special out-of-hours orders have 5000 / three-working-day phone conditions. These are configurable reviewed rules, not universal automated eligibility. |
| Branch availability | [B3 branch list](https://vegetsai.com.tw/branches.html), B1 | Static delivery outlets differ from counters; counters do not offer online ordering. Minsheng self-pickup/delivery is suspended from 2025-05-16. Actual selected online branch and delivery address need current human confirmation. |
| Current menu / prices / stock | [B4 product information](https://www.vegetsai.com.tw/products.html), B2 | Product introduction is not a live sale catalog. Price/style vary with location/latest menu. Exact SKU/options, service-date availability, price and stock must be entered/confirmed; do not infer from historical names. |
| Submission vs acceptance | B1, [B5 FAQ](https://www.vegetsai.com.tw/qa.html) | Sending precedes human merchant acceptance; member area can display status. A three-digit pickup code is not proved to be a globally unique order ID. FAQ 09:00–14:00 operating/manual-acceptance hours are not the 11:00–13:00 delivery window. |
| Group ordering | [M1 product page](https://www.maifood.com.tw/online-ordering/), [M2 official group tutorial](https://help.maifood.com.tw/2021/02/22/%E6%8F%AA%E5%9C%98%E8%A8%82%E9%A4%90/) | Product supports group leader links and member entries; this does not prove a chosen Vegetsai branch has enabled the feature or permits third-party order creation. |
| Consumer login/cart/checkout | [M3 consumer tutorial](https://help.maifood.com.tw/2024/06/14/elementor-15505/) | Documented SMS verification, pickup, payment and submit UI. Own test-account login→pre-checkout, OTP/CAPTCHA, final reference visibility and conditions are **NOT VERIFIED**; no account supplied or requested. |
| ERP sync | [M4 ERP page](https://www.maifood.com.tw/erp-api/), [M5 linked public folder](https://drive.google.com/drive/folders/19cL9_eclMoc2MPCKA6a-fCs_V6l_gb31), [M6 technical PDF](https://drive.google.com/file/d/1ccy1IdBjc_-MxFjB4Uv-foKQFSv6GCBp/view?usp=drivesdk) | JSON POS checkout-data transfer to ERP, not customer-order creation. Technical PDF file date 20260316 / version table v1.1.1 dated 2026-03-17. |
| ERP endpoints | M6 | Documents GET `erp/company/{$company_id}/billings`, GET `erp/company/{$company_id}/payment_list`, POST `erp/login`. Billing establish/cancel refers to checkout records, not merchant acceptance/delivery. Billing products are sold details, not a sellable-menu API. None were called. |
| ERP auth / test host / rate | M6 | Documented ERP test/production hosts, issued account/company ID, Bearer valid one day, 100 requests/hour; recommended 30-second spacing does not alone satisfy the hourly limit (continuous polling would be 120/hour). A future authorized client needs a total budget as well. No credentials copied or created. |
| ERP pagination/history | M6 | Documented page size 100, query span 31 days, checkout history within two years. Not an order-create/confirmation contract. |
| Order-create, status, cancellation API, webhook, signature, idempotency | M4/M6 examined public contract | **NOT ESTABLISHED**. Require written merchant/platform scope, sandbox evidence, authenticated contract tests and reconciliation semantics before enabling any adapter. |
| Costs / onboarding | M4, M6 | Advertised ERP setup 20000 (original 25000), per-store monthly 1000; currency/tax/final contract and any order-write service are not assumed. PDF estimates existing/new customer setup about 7/14 working days, not a commitment. No inquiry, payment or purchase made. |

Provenance: B1/B3/B4/B5/M1/M4 were read directly through public web retrieval in this session. iMenu and the Drive PDF could not be fully rendered by this runtime; detailed M6 observations were supplied by the delegating thread's read-only public-document research. Preserve that distinction; do not claim a local browser/account flow or API test. No private endpoint was guessed.

## Gates still required for an official adapter

1. Merchant confirms service branch, delivery address, SKU/options/date pricing, fees and payment responsibility.
2. Platform/merchant grants this app explicit order-create/status/reconcile permissions and provides a supported documented contract, auth/secret ownership, rate/cost terms and an isolated sandbox.
3. Verify idempotent creation, timeout/lost-response query recovery, webhook signatures/replay defense and accepted vs submitted status with mock then authorized sandbox evidence.
4. Record final-send human confirmation, outbound domain allowlist, secret management, audit masking and payment reconciliation. No unattended payment or cron submission.

Missing external authorization blocks only these gates. It does not block internal MANUAL implementation.

## Internal implementation contract

- Use only ACTIVE orders in a selected vendor/branch/date/address/floor scope, retaining original source IDs/line numbers, charged amounts and history. No legacy-name/ID-only merging.
- Resolve canonical `menu_item_id` and an explicit BASE/HALF/PLUS variant from existing effective-date rules. Existing order items have no variant snapshot and nullable menu identity: ambiguous rows fail closed and remain visible as unmapped, never guessed. Preserve daily flavor E/A/AM display projection.
- Date/time is Asia/Taipei. Existing mode A internal deadline 10:00 / B previous-day 18:00 and external cutoff are separate, configurable branch policies; government holiday calendars do not automatically prove vendor closure.
- Dedicated permission: LINE-authenticated active registered Admin, or ProxyAdmin with an explicit live branch grant. `READ_ADMIN_SUMMARY` deliberately includes general User/guest and is not suitable. Reject View As and guest mutation authority.
- Snapshot hash includes source membership/status/line versions, identities/options/notes, quantities/charged and external amounts, fees, mapping and branch-policy revisions, delivery scope. An atomic D1 guard compares the source/config captured at review; source additions/cancellations/replacements and mapping changes invalidate approval.
- D1 unique batch scope/snapshot claim plus unique source-order/line reservations prevent two operators, new batches and response-loss retries from creating unnoticed overlapping handoffs. Claims persist in SUBMITTING/UNKNOWN and are not released by timeouts or leases.
- State machine separates prepared handoff, operator-reported submission and merchant report. UNKNOWN permits reconciliation/report only; no blind resubmit. Source drift after claim is a reconciliation alert; never change the source cancellation/refund behavior.
- The organizer settles the vendor once on behalf of the group. Employees already charged internally must not be charged again by this workflow. Internal subtotal is preserved; external price/fee differences and reported payment are explicit review/reconciliation fields. No wallet/topup/ledger writes, automatic external payment or refund. Unsupported payment responsibility blocks readiness.
- Output only aggregated products/options/notes and floor totals, not employee names/LINE IDs/tokens. Protected source IDs remain internal; append-only audit stores actor/action/hash/time with no credentials. Error logs avoid payload/PII.

## Staged Draft PRs and acceptance trace

1. P0: this evidence/decision, source limits and authorization gates (no runtime change).
2. Internal Worker/D1 vertical slice: additive schema, mappings/policies/grants, aggregation, review, claim/reservations, MANUAL adapter/report/reconcile, audit and safety tests together. Critical concurrency/stale guards ship before a handoff endpoint is exposed, rather than deferred.
3. Management UI: canonical authorization discovery, configuration and mapping review, hash/diff confirmation, privacy-safe manual sheet and report/reconciliation with clear provenance. Existing order/auth/ledger paths remain unchanged.
4. Official adapter: explicitly deferred NO-GO; requires gates above and a new reviewable PR.

P0 authenticated browser/account/API/sandbox steps remain NOT VERIFIED/NOT RUN. Source-level/manual fixtures are not production evidence. Keep Issue #36 open.

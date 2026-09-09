# React-to-Worker transport boundary and cutover matrix

Status: implemented as a bounded pre-cutover slice. `gas` is still the
default transport. Selecting `worker` is an explicit environment decision and
does not deploy or cut over production traffic.

## Architecture

- `src/api/apiClient.js` is the Vite runtime binding. It resolves the selected
  transport once and exposes the domain-oriented `apiClient` facade.
- `src/api/apiClientCore.js` contains the injectable transport and operation
  mapping used by tests. Worker requests use the LINE access token only as a
  Bearer credential; client-supplied user IDs are not sent to Worker routes.
- `src/api/transportConfig.js` accepts only `gas` or `worker`. An omitted value
  resolves to `gas`. Worker mode requires `VITE_WORKER_API_URL`; it has no GAS
  fallback. Mock auth is an explicit local mode and cannot be combined with
  Worker transport.
- `src/api/apiErrors.js` gives configuration, authentication, authorization,
  backend, and Worker contract gaps distinct typed error categories.
- `src/api/gasApi.js` retains the existing GAS wire format and mock adapter. Its
  factory/lazy compatibility exports allow Worker-only environments to omit a
  GAS URL without creating a fallback path.
- `src/App.jsx` calls domain operations only; GAS action names remain inside
  the GAS adapter and its compatibility tests.

The current Worker mapping is intentionally limited to formal routes directly
implemented and covered by formal runtime tests. Existing formal endpoints
that need a reviewed request/response or idempotency adapter remain explicit
gaps.

## Formal proof basis

The following mappings are supported by the formal runtime and direct tests:

| Domain operation | Formal runtime | Direct evidence |
| --- | --- | --- |
| Identity read, including unregistered identity | `GET /api/me` | `worker-poc/src/routes/readOnly.js`; `worker-poc/tests/read-only.test.js` |
| Registration | `POST /api/register` | `worker-poc/src/routes/me.js`; `worker-poc/tests/read-only.test.js` |
| Primary bootstrap | `GET /api/me` preflight, then registered-only `GET /api/bootstrap` | `worker-poc/src/routes/readOnly.js`; `worker-poc/tests/read-only.test.js` |
| Deferred bootstrap | `GET /api/bootstrap/deferred?bootId=...` | `worker-poc/src/routes/readOnly.js`; `worker-poc/tests/read-only.test.js` |
| Calendar read | `GET /api/calendar` | `worker-poc/src/routes/readOnly.js`; `worker-poc/tests/announcements.test.js` |
| Active order map | `GET /api/orders/map` | `worker-poc/src/routes/readOnly.js`; `worker-poc/tests/read-only.test.js` |
| Order page read | `GET /api/order-page?targetDate=...` | `worker-poc/src/routes/readOnly.js`; `worker-poc/tests/read-only.test.js` |
| Pickup-floor update | `PATCH /api/me/pickup-floor` | `worker-poc/src/routes/me.js`; `worker-poc/tests/read-only.test.js` |

The formal primary bootstrap currently generates its own response `bootId`.
The frontend correlation ID is still forwarded to the deferred endpoint, whose
response echoes it exactly. This slice does not redefine that backend
observability detail.

## Complete GAS → Worker matrix

Status meanings:

- `SUPPORTED`: the formal route and the current frontend adapter are proven.
- `ADAPTER_REQUIRED`: a formal route exists, but the current React/GAS
  request, response, idempotency, or View As semantics are not yet adapted.
- `WORKER_CONTRACT_MISSING`: no formal production route or approved adapter is
  available. The Worker transport throws a typed gap and never calls GAS.
- `LEGACY_ONLY`: retained compatibility behavior; not a Worker cutover target
  in this slice.

### Startup critical path

| Current React/domain operation | Legacy GAS wire | Formal Worker wire | Status |
| --- | --- | --- | --- |
| `getBootstrap` | `POST getBootstrapData` with access token, bootId, `deferUiData: true` | `GET /api/me` preflight; registered users then `GET /api/bootstrap?bootId=...` with Bearer token | SUPPORTED |
| `getIdentity` | `POST getUserInfo` with access token | `GET /api/me` with Bearer token | SUPPORTED |
| `register` | `POST registerUser` with access token and pickup floor | `POST /api/register` with Bearer token and `{pickupFloor}` | SUPPORTED |
| `getDeferredBootstrap` | `POST getDeferredBootstrapData` with access token and bootId | `GET /api/bootstrap/deferred?bootId=...` with Bearer token | SUPPORTED |
| Unregistered identity handling | GAS identity response with `registered: false` | Worker `/api/me` token-derived response with `registered: false`; no D1 user creation | SUPPORTED |

### Normal user post-startup operations

| Current React/domain operation | Legacy GAS wire | Formal Worker wire | Status |
| --- | --- | --- | --- |
| `getCalendar` | `GET getCalendarEvents&userId=...` | `GET /api/calendar` with Bearer token | SUPPORTED |
| `getOrdersMap` | `GET getUserAllOrdersMap&userId=...` | `GET /api/orders/map` with Bearer token | SUPPORTED |
| `getOrderPage` | `GET getOrderPageData&targetDate=...&userId=...` | `GET /api/order-page?targetDate=...` with Bearer token | SUPPORTED |
| `updatePickupFloor` | `POST updateMyPickupFloor` | `PATCH /api/me/pickup-floor` with Bearer token and `{pickupFloor}` | SUPPORTED |
| `toggleLike` | `POST toggleLike` with access token, date, and user ID | `POST /api/calendar/:date/like` with Bearer token; response maps `isLiked`/`totalLikes` to the existing like state | SUPPORTED |
| `getBalanceHistory` | `POST getBalanceHistoryByMonth` | `GET /api/me/balance/history?month=YYYY-MM` | ADAPTER_REQUIRED: formal Option 1 policy-boundary errors and response shape must be surfaced deliberately |

### Order mutations

| Current React/domain operation | Legacy GAS wire | Formal Worker wire | Status |
| --- | --- | --- | --- |
| `submitOrder` | `POST submitOrder` with client payload and access token | `POST /api/orders` with Bearer token and formal idempotency key | ADAPTER_REQUIRED: current UI does not supply the formal idempotency-key contract |
| `cancelOrder` | `POST cancelOrder` with client payload and access token | `POST /api/orders/:orderId/cancel` with Bearer token and formal idempotency key | ADAPTER_REQUIRED: current UI does not supply the formal idempotency-key contract |

### Admin operations

| Current React/domain operation | Legacy GAS wire | Formal Worker wire | Status |
| --- | --- | --- | --- |
| `getAdminSummary` | `POST getAdminSummary` with access token and target date | `GET /api/admin/summary?date=...` with Bearer token | ADAPTER_REQUIRED: method, query, and View As read-subject mapping need review |
| `getMemberBalances` | `POST getMemberBalances` with access token | `GET /api/admin/members/balances` with Bearer token | ADAPTER_REQUIRED: formal authorization/audit and response adapter not wired |
| `topUpBalance` | `POST topUpBalance` with access token, target, amount, note | `POST /api/admin/balances/top-up` with Bearer token and formal idempotency key | ADAPTER_REQUIRED: current UI lacks the formal idempotency-key and response adapter |
| `setCalendarVendor` | `POST adminSetVendor` with access token and date/vendor | `PUT /api/admin/calendar/:date` with Bearer token and `{vendor, mode}` | ADAPTER_REQUIRED: formal mode field and authorization contract are not wired |
| Role assignment (no current React caller) | `POST assignProxy` | `PUT /api/admin/users/:userId/role` with Bearer token and `{role}` | ADAPTER_REQUIRED: no current React caller or reviewed UI adapter |

### View As / ProxyAdmin

| Capability | Legacy behavior | Formal Worker contract | Status |
| --- | --- | --- | --- |
| Read-only View As summary/member reads | GAS action receives authenticated actor plus legacy target semantics | Formal GET routes accept a read-only View As target, authorize the actor, and audit actor/effective subject | ADAPTER_REQUIRED: current React facade does not send View As query state |
| View As order/calendar reads | Current UI derives presentation state locally; writes are guarded | Worker read routes resolve an effective read subject while retaining the authorization actor | ADAPTER_REQUIRED: no frontend View As query adapter in this slice |
| View As mutations | UI blocks writes while View As is active | Formal mutation routes disallow View As | ADAPTER_REQUIRED in this facade: no mutation adapter or fallback is allowed |
| ProxyAdmin finance/identity access | GAS permission model | Formal permission model denies finance and identity management while retaining approved operational reads | ADAPTER_REQUIRED: no admin facade cutover in this slice |

### Compatibility and deferred paths

| Legacy capability | Formal Worker mapping | Status |
| --- | --- | --- |
| GAS `INVALID_ACTION` startup fallback: `getUserInfo` → `getUserAllOrdersMap` → `getCalendarEvents` | Worker does not emulate GAS action dispatch; explicit startup routes are used instead | LEGACY_ONLY; no Worker → GAS fallback |
| Legacy `GET getInitData` | No formal production route | WORKER_CONTRACT_MISSING |
| Legacy diagnostic `GET getOrders` | Retained POC diagnostic only; no formal production route | WORKER_CONTRACT_MISSING |
| Legacy diagnostic `GET getUserOrder` | No formal production route | WORKER_CONTRACT_MISSING |
| Legacy `GET getBalanceHistory` alias | Formal monthly history route exists, but no current React caller or approved response adapter | ADAPTER_REQUIRED |

## Isolation guarantees

- With no `VITE_API_TRANSPORT`, the selected transport is `gas` and the GAS
  adapter receives the same action payloads and legacy GET query shapes.
- With `VITE_API_TRANSPORT=worker`, `VITE_WORKER_API_URL` is mandatory; the
  runtime creates no GAS adapter, and unsupported operations throw
  `ApiContractGapError` before any network call.
- Worker requests never send `userId`, `adminUserId`, or `accessToken` in the
  URL/body as authority. The token is sent only as an Authorization Bearer
  credential; formal Worker identity derives from it.
- Mock auth remains a local adapter seam and never calls network fetch. It is
  rejected if combined with explicit Worker transport.

## Next bounded slice

The smallest next backend/frontend slice is a reviewed formal order-mutation
adapter: define the UI idempotency-key lifecycle, map the formal request and
response envelopes, and exercise replacement/cancellation against isolated
formal D1. Finance and admin adapters should follow separately so opening
balance policy errors, actor/effective-subject audit fields, and top-up
idempotency are not hidden by a generic compatibility layer.

No production deployment, React cutover, GAS removal, workbook change, remote
D1 operation, commit, or push is part of this slice.

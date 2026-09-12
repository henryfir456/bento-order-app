# 0.13.0 Identity / Verification Simplification

## 文件狀態

- 狀態：Superseding spec，等待 review；本文件不是 implementation plan。
- 目標版本：0.13.0。
- 適用範圍：正式 Cloudflare Worker + D1 identity、authorization、LINE
  employee binding，以及 React frontend 對這些 state 的消費方式。
- 本文件只定義簡化後的產品 contract；本次建立文件不修改程式碼、
  migration、remote D1、frontend deployment 或 remote data。

本文件 supersede 先前文件對 active runtime 的 verification 語意，尤其是：

- docs/superpowers/specs/2026-09-11-admin-identity-management-0.13.0-design.md
- docs/superpowers/plans/2026-09-11-admin-identity-management-0.13.0.md
- docs/superpowers/specs/2026-09-12-provisional-employee-claim-design.md
- docs/superpowers/plans/2026-09-12-provisional-employee-claim.md

上述 spec/plan 必須保留原檔，作為歷史設計、atomicity 決策與 rollout
證據；不可直接改寫。若實作與舊文件不一致，以本 superseding spec
對 active 0.13.0 runtime 的條文為準。

## 產品決策摘要

0.13.0 的 authoritative access definition 是：

    active canonical user
    + auth mode = LINE
    + employee_id 存在且為有效 normalized employee id
    => registered = true
    => 依 canonical role 取得 capabilities

verification_status、employee_roster 與 roster trust decision 不再是
active LINE flow 的登入或授權前置條件。既有 role 不因 employee binding
而被降級；因此 role=Admin 的 active LINE canonical user 綁定員編後，
即使 verification_status 歷史值是 UNVERIFIED，也直接具有 Admin role
capabilities。

employee_guest 仍是 guest-only authentication boundary。資料列上的 role
不會讓 employee_guest 取得 LINE canonical user 的權限，也不能把
line_user_id=NULL 直接解讀成可被 takeover 的 provisional row。

## 不在本次範圍

- 不新增或修改 migration；不 rollback、刪除或重建 0003 / 0004。
- 不刪除 users.verification_status 或 employee_roster。
- 不新增 provisioning_source、merged_into_user_id、永久 assertion table
  或其他 lineage schema。
- 不新增 Admin approval、verification review workflow、roster import 或
  manual merge workflow。
- 不把 employee_roster 的資料補進 remote；不修改 remote D1。
- 不新增 claim=true、lineUserId、verificationStatus 或 provisional user id
  等 frontend request 欄位。
- 不建立第二個 claim endpoint；沿用已 authenticated 的
  POST /api/auth/line-employee-bind。
- 不自動 re-parent orders、order history、balance ledger、opening balance、
  likes、idempotency 或任何其他 canonical business ownership。
- 不把 audit/history reference 當成 dependency blocker。
- 不 deploy frontend、不 merge main；remote transition 只在後續明確授權
  後進行。

## A. Simplified authoritative state machine

### A.1 Authoritative states

| Internal state | Database shape | Public compatibility projection | Access |
| --- | --- | --- | --- |
| AUTH_REQUIRED | 沒有有效 bearer identity | 401 | 無 |
| LINE_CANONICAL_UNBOUND | active=1、line_user_id 有值、employee_id=NULL | registered=false、identityState=EMPLOYEE_BIND_REQUIRED、status=EMPLOYEE_BIND_REQUIRED | 只能登入後完成員編綁定與現有 onboarding self actions |
| LINE_CANONICAL_REGISTERED | active=1、line_user_id 有值、employee_id 有值 | registered=true；identityState/status 可暫保留 VERIFIED 作為 registered compatibility token | 依 canonical role |
| EMPLOYEE_GUEST_PROVISIONAL | active=1、employee_guest canonical row；通常 line_user_id=NULL，且有 guest provenance | registered=false；舊 guest/provisional status 可保留 | guest-only；不因 stored role 取得 Admin/ProxyAdmin |
| RETIRED_CANONICAL | active=0；claim 後 employee_id=NULL，row 保留 | 不可作為 active principal | 無 |
| INACTIVE_CANONICAL | active=0 | legacy readback 可見但不可授權 | 無 |

LINE_CANONICAL_REGISTERED 是唯一的正常 LINE application access state。
只要 active LINE canonical user 有 employee_id，就直接進系統，不會進入
PENDING_VERIFICATION 或 EXISTING_UNVERIFIED_EMPLOYEE active branch。

### A.2 Transition rules

1. LINE 使用者先經既有 LINE authentication；Worker 以 token 解出的 LINE
   profile / LINE user id 決定 canonical identity。
2. LINE canonical row 若 employee_id=NULL，公開 state 是
   EMPLOYEE_BIND_REQUIRED；role 仍存於 row，但未完成 binding 前不授予
   role-based application 或 Admin capabilities。
3. 既有 LINE canonical row 綁定 employee_id 後，立即轉為
   LINE_CANONICAL_REGISTERED。binding 不讀 employee_roster，不修改
   verification_status，不產生 PENDING_VERIFICATION。
4. employee_guest provisional owner 被 LINE survivor claim 時，在同一
   atomic operation 中 release employee ownership、retire owner、assign
   survivor、revoke matching guest sessions、寫 lineage audit。
5. claim 不修改 survivor 的 role、active、line_user_id 或
   verification_status。survivor 原有 verification_status 只作歷史欄位
   保存。
6. provisional row 不 hard delete；retire 後 active=0、employee_id=NULL，
   其他歷史欄位與 audit lineage 保留。
7. 不存在從 LINE_CANONICAL_REGISTERED 轉到 PENDING_VERIFICATION 的
   active runtime transition。verification_status 後續即使是 UNVERIFIED，
   仍維持 registered 與 role capabilities。
8. inactive row 永遠不能藉由 employee id、guest token 或 LINE request
   自動恢復；恢復是未來獨立的受控流程。

### A.3 Compatibility projection

為減少 0.13.0 對既有 API/frontend consumer 的破壞，以下投影可暫時保留：

- bound LINE canonical 的 identityState=VERIFIED；
- /api/me 或既有 binding response 的 status=VERIFIED；
- verificationStatus=VERIFIED 或 UNVERIFIED 的歷史值；
- 舊的 PENDING_VERIFICATION、EXISTING_UNVERIFIED_EMPLOYEE、
  UNVERIFIED_EMPLOYEE 名稱在 legacy parser、guest session 或歷史資料中
  可被讀取。

這些值在簡化後不再代表「已由 roster 或人工核驗」。REGISTERED 的
authoritative 判斷只使用 active、LINE identity 與 employee_id。

## B. Binding / claim decision tree

### B.1 Request and identity boundary

仍使用 authenticated LINE employee-binding endpoint。Worker 必須：

1. 驗證 LINE bearer token；
2. 從 server-side LINE profile 取得 line_user_id；
3. 解析目前的 LINE canonical survivor；
4. normalize/validate employee id；
5. 由 D1 讀取 normalized employee ownership；
6. server-side 決定 normal bind、idempotent success、atomic claim 或
   conflict。

Frontend 不得傳入或影響 claim decision 的 claim、lineUserId、
verificationStatus、provisional user id。client 知道 employee id 不等於
有權 takeover 任何 canonical user。

### B.2 Exact decision tree

對 normalized employee id，Worker 必須先查所有 canonical users 的
normalized ownership，不可用 LIMIT 1 當作安全判定：

1. **No owner**

   沒有任何 users row 持有該 normalized employee id，走現有 normal LINE
   binding flow。此 flow 不查 roster，也不以 verification_status 決定
   是否可登入。

2. **Owner equals current LINE survivor**

   current authenticated LINE survivor 已持有該 normalized employee id，
   回傳 idempotent success/readback。不得 retire row、重複 revoke 或
   新增第二筆 claim audit。

3. **Other owner is explicitly claimable employee_guest provisional**

   只有完整符合 B.3 的 owner 才能進入 claimProvisionalEmployee。claim
   會在同一個 D1 atomic operation 中完成 B.4 的 transfer。

4. **Any other existing owner**

   包含 LINE-bound owner、active 或 inactive 的非-provisional owner、
   缺少 historical guest provenance、ambiguous/duplicate normalized
   ownership、unsafe business ownership、競爭 ownership、或其他無法
   明確證明為 provisional 的 owner，皆回傳：

       409 EMPLOYEE_ID_ALREADY_BOUND

   line_user_id=NULL 只是一個必要 shape，絕不是 takeover authorization。

### B.3 Claimable provisional predicate

Claim mutation 重新檢查下列全部條件；前一輪 read-only diagnosis 不具
授權效力：

- authenticated survivor 是指定的 canonical user；
- survivor active=1；
- survivor line_user_id 等於 server 解出的 exact LINE user id；
- survivor employee_id IS NULL；
- normalized employee ownership count 恰為 1，且該 owner 不等於 survivor；
- owner active=1；
- owner line_user_id IS NULL；
- owner employee_id 的 normalized value 等於 request value；
- 至少一筆 server-verifiable historical
  employee_guest_sessions provenance：
  - user_id=owner.user_id；
  - auth_mode=employee_guest；
  - status=UNVERIFIED_EMPLOYEE（目前 schema 對 provisional guest
    provenance 的既有 encoding）；
  - session employee_id 的 normalized value 相符；
- evidence 是 historical evidence：不得要求 revoked_at IS NULL，也不得
  要求 expires_at > now。已過期或已 revoke 的 matching guest session
  仍能證明 provenance；
- owner 不存在任何本 spec 定義的 unsafe canonical business ownership；
- normalized ownership 沒有 duplicate、ambiguous 或 competing owner。

目前既有的 privileged provisional-owner guard 保留：owner.role 為
Admin 或 ProxyAdmin 時，不視為可自動 retire 的 provisional owner，回傳
EMPLOYEE_ID_ALREADY_BOUND。這是避免自動處理 privileged canonical row 的
identity-safety guard，不是 verification 或 roster gate；survivor 的
canonical role 完全保留。

owner.verification_status 不在上述 predicate 中，不得因 UNVERIFIED 或
VERIFIED 的值單獨放行或拒絕 claim。employee_roster 不在上述 predicate
中，也不可於 claim 中查詢。

### B.4 Claim postconditions

成功 commit 後，authoritative state 必須是：

- LINE survivor：
  - line_user_id 保留；
  - employee_id 設為 normalized requested employee id；
  - active=1；
  - role 保留原值，包括 Admin / ProxyAdmin；
  - verification_status 保留原值，不因 claim 改寫。
- provisional owner：
  - row 保留；
  - active=0；
  - employee_id=NULL；
  - line_user_id=NULL；
  - 不 hard delete。
- matching employee_guest sessions：
  - 仍有效且未 revoke 的 matching sessions 全部 revoke；
  - matching historical sessions 若已 expired 或已 revoked，保留歷史
    狀態，不需要也不應重寫。
- audit：
  - 寫入一筆明確的 PROVISIONAL_EMPLOYEE_CLAIMED；
  - 包含 survivor/actor user id、retired provisional user id、employee id
    digest、outcome=CLAIMED；
  - 可保留 survivor verificationStatus snapshot 作 informational
    lineage，但不得寫 roster verification decision；
  - 不含 raw guest token。
- response：
  - 由 mutation 後的 authoritative survivor readback 組成；
  - /api/me 顯示 authSource=LINE、registered=true、employeeId；
  - 若歷史欄位仍輸出 verificationStatus=UNVERIFIED，仍不得產生
    PENDING_VERIFICATION active flow。

### B.5 True business dependency guard

只有會造成 canonical user business ownership 無法安全 re-parent 的資料
才是 blocker。claim 不搬移任何資料；以下 current formal schema
ownership references 只要存在即 fail closed：

- orders.user_id；
- balance_ledger.user_id；
- opening_balance_snapshots.user_id；
- likes.user_id；
- idempotency_keys.actor_user_id。

order history 的 actor/reference 欄位是歷史 lineage；若該 order 本身由
owner.user_id 持有，orders.user_id 已是 blocker，仍不 re-parent order 或
history。以下不是 blocker：

- admin_audit_log 的 actor/target/reference；
- order status history actor 欄位；
- balance ledger operator 欄位；
- calendar updater 欄位；
- import/review actor 欄位；
- employee_guest_sessions evidence 或 session history。

若命中真正 business dependency，使用既有明確錯誤：

    409 PROVISIONAL_IDENTITY_HAS_DEPENDENCIES

不得因 audit/history reference 或 historical guest evidence 單獨回傳
dependency error。

## Atomic transfer contract

這一節承接並保留上一份 provisional claim spec 已核准的 D1 atomicity
決策，但把 roster/verification mutation 從 transfer 移除。

### Supported primitive and failure rule

正式 runtime 只使用 prepared statements 傳給 D1Database.batch()。
D1 batch 以順序執行的 statements 作為一個 transaction；任何 statement
產生真正 SQL error 時，整個 batch rollback。分開的 prepare().run()
不構成同一 transaction。

UPDATE 命中 0 rows 本身不是 SQL error，因此不能在 batch 完成後才檢查
meta.changes 再宣稱 rollback。每個必要的一列 DML 後都要立即放入既有
employee_guest_sessions.token_hash NOT NULL constraint 的 SQL-level
assertion：

    INSERT INTO employee_guest_sessions (session_id, token_hash, expires_at)
    SELECT ?, NULL, ?
    WHERE changes() <> 1;

當前一個 guarded DML 恰好改一列，SELECT 不產生 row，assertion 成功。
當 changes() 為 0 或大於 1 時，INSERT 嘗試寫入 token_hash=NULL，產生
真正的 NOT NULL SQL failure；D1 在 batch commit 前 rollback 全部先前
statements。assertion 使用新產生的 session_id，失敗列不會留下。

assertion 必須緊鄰其 guarded DML，中間不可插入會改變 changes() 的 SQL。
成功 batch 後可以讀 metadata 作 diagnostics，但 metadata 不得作為
rollback decision。

### Shared session revoke predicate

session revoke UPDATE 與 revoke postcondition 必須使用完全相同的
predicate，不得各自簡化或遺漏 auth mode、有效期或 revoke 狀態：

    auth_mode = 'employee_guest'
    AND revoked_at IS NULL
    AND expires_at > batch_clock
    AND (
      (
        employee_id IS NOT NULL
        AND length(trim(employee_id)) > 0
        AND UPPER(trim(employee_id)) = normalized_employee_id
      )
      OR user_id = retired_provisional_user_id
    )

employee-id / user-id 的 OR 必須置於括號內，並且整體受前面的
auth_mode、revoked_at 與 expires_at 條件約束。如此 expired、已 revoked
或 non-employee_guest sessions 不會因 user_id 命中而被 revoke；employee
id matching 仍涵蓋 user_id IS NULL 的 guest sessions。

### Ordered mutation

同一個 batch 的順序如下；所有 employee id、user id、LINE id、timestamp
與 assertion session id 都是 bind parameters，不把 user input 插入 SQL：

1. survivor guard：只有 exact survivor user id、exact LINE user id、
   active=1、employee_id IS NULL 才更新 harmless updated_at。
2. survivor guard assertion：使用 token_hash NOT NULL assertion，失敗即
   rollback。
3. owner release：在同一 SQL WHERE 重新確認 survivor、唯一 normalized
   owner、owner active/LINE-null、historical employee_guest evidence、
   privileged guard、business dependency 與 competing ownership，成功時
   將 owner.employee_id=NULL。
4. release assertion：失敗即 rollback，provisional owner 的原 employee
   ownership 仍在。
5. owner retire：只對剛 release 的 exact owner 更新 active=0、
   employee_id=NULL；保留 row、role、audit/history references。
6. retire assertion：失敗即 rollback。
7. survivor assignment：只對仍是 exact active LINE survivor、employee_id
   仍為 NULL、且 retired owner 已是 active=0/employee_id=NULL 的 state
   設定 employee_id。不得 SET 或由 roster CASE 改寫
   verification_status。
8. assignment assertion：失敗即 rollback，包含先前 release/retire。
9. session revoke：以 set-based UPDATE 使用 Shared session revoke
   predicate，revoke 所有符合
   auth_mode=employee_guest、revoked_at IS NULL、expires_at > batch_clock
   且括號內 normalized employee_id 相符或 user_id=retired owner 的
   sessions；其中 employee_id matching 會涵蓋 user_id IS NULL 的 sessions。
10. revoke postcondition：使用與第 9 步完全相同的 predicate；若任何符合
    predicate 的 session 留下，以同一 token_hash NOT NULL constraint
    產生 SQL failure；零筆符合 predicate 的 session 是合法成功結果。
11. audit insert：寫入恰一筆 PROVISIONAL_EMPLOYEE_CLAIMED，包含
    survivor/retired owner lineage、employee digest、outcome，不能包含
    raw token。
12. audit assertion：用 changes()<>1 轉成 SQL failure；audit 缺失或多筆
    不得 commit。

batch 執行使用現有 transactions helper（runMutationBatch）。若任何
assertion、unique index、foreign key 或其他 SQL constraint failure，
只接受 D1 rollback 後的 failure；不得做 batch 後 JavaScript 補償式
cleanup。

### Concurrency proof obligation

第一輪 diagnosis 只是錯誤分類與 observability。真正 mutation 必須在
batch 內重新讀條件。

- 若 batch 開始前 survivor 被別人綁定、停用或改變 line/employee state，
  survivor guard changes=0，assertion 直接使 whole batch rollback；owner
  保持原 employee_id、active=1。
- 若 owner 在 batch 前被改為 LINE-bound、inactive、duplicate 或有
  dependency，release changes=0，release assertion rollback；不會 retire
  或 release。
- 若 release 成功後 assignment 因任何競態 guard/state 改變而命中 0
  rows，assignment assertion 在同一 atomic operation 內產生 NOT NULL
  SQL error。D1 rollback release、retire、session revoke、audit；因此
  provisional owner 恢復原 employee_id 與 active=1，survivor 仍未綁定。
- D1 batch 內 statements 是同一 transaction 的順序 mutation；不能接受
  「release 已 commit，之後 survivor assignment 才失敗」的 partial
  ownership state。
- normalized employee unique index 若在 assignment 或其他 mutation 失敗，
  同樣是 SQL failure，whole batch rollback。
- transaction failure 後只能做 readback/classification；若 state 不是
  authoritative success 或已知 409，fail closed，不回報 claim success。

## C. Central authorization matrix

Worker 的 central permissions.js / identity.js / assertCan() 是唯一
authorization boundary。frontend navigation、button visibility 或
View As UI 都不是 security boundary。所有 Admin、ProxyAdmin、View As
與 business mutation routes 都必須經 central capability check。

| Principal shape | registered | Effective capabilities |
| --- | --- | --- |
| inactive canonical，任一 auth mode | false for authorization | none；所有 protected route 403/401 |
| active employee_guest，任何 stored role/status | false | existing guest self actions only；不得有 READ_ADMIN_SUMMARY、任何 ADMIN_*、VIEW_AS、CAN_BIND_EMPLOYEE |
| active LINE canonical，employee_id=NULL | false | EMPLOYEE_BIND_REQUIRED；只保留既有 binding/onboarding self actions |
| active LINE canonical + employee_id，role=User | true | User role action set |
| active LINE canonical + employee_id，role=ProxyAdmin | true | ProxyAdmin role action set |
| active LINE canonical + employee_id，role=Admin | true | Admin role action set |

verification_status 的 VERIFIED/UNVERIFIED、employee_roster match、或
歷史 PENDING_VERIFICATION 值不得改變上述 effective capabilities。
定義可寫成：

    effective privileges =
      active LINE canonical with employee_id
      ? canonical role privileges
      : onboarding-only or guest-only

更精確地說，active 是必要條件；authMode=LINE 且 employee_id 存在才是
registered role principal。employee_guest 即使 stored role=Admin，也只
能使用 guest action set。

### C.1 API coverage

以下 route/domain 透過 assertCan 的中心矩陣授權，不得各自重新判斷
verification_status：

- self read/profile/order paths：依 registered 或 guest self boundary；
- admin summary、member balance read；
- balance top-up / balance mutation；
- calendar mutation；
- role mutation；
- announcements mutation；
- Admin employee-binding；
- View As resolution 與所有 View As read paths；
- 其他現有 ADMIN_*、VIEW_AS 或 business ownership mutation。

Admin employee-binding 是 Admin role capability，不是 verification approval。
它只接受 registered active LINE canonical Admin，必要條件是
active=1 + authMode=LINE + employee_id exists + role=Admin；不查 roster、
不要求 verification_status=VERIFIED，也不因 binding 改寫 canonical role。
Self LINE employee binding/onboarding 仍依 unbound LINE 的 self-action
boundary，不屬於 Admin capability。

View As eligibility 只要求 active LINE canonical principal、既有 role
capability 包含 VIEW_AS、target 存在且符合現有 target safety rules。
verification_status 不得成為 View As gate。

## D. Legacy compatibility fields

| Field / value | 0.13.0 compatibility behavior | Prohibited meaning |
| --- | --- | --- |
| users.verification_status | schema 保留；讀取/序列化可保留歷史 VERIFIED/UNVERIFIED；claim 與 LINE binding 不改寫 | 不代表 active access、人工核驗或 roster trust |
| public verificationStatus | 可繼續輸出 informational historical value | 不可用來把 LINE user 變成 provisional 或拒絕正常功能 |
| identityState=VERIFIED | bound LINE 的 registered compatibility projection | 不代表 roster verified |
| status=VERIFIED | /api/me 或既有 consumer 需要時保留為 registered token | 不代表 verification decision |
| PENDING_VERIFICATION | 舊資料、舊 parser、歷史 audit/test fixture 可讀 | 不得作為 active LINE state、login gate 或 admin gate |
| EXISTING_UNVERIFIED_EMPLOYEE | source compatibility name 可保留 | 不得觸發 canonical LINE onboarding-only |
| UNVERIFIED_EMPLOYEE | employee_guest session/legacy guest contract 可保留 | 不得代表 LINE canonical 不能正常使用 |
| PENDING_TRUST_REVIEW / roster reason | 舊 audit/legacy resolver 可讀 | 不產生新的 runtime roster decision |
| employee_roster | table、schema、既有資料保留 | 不再是 runtime access trust source |

新 LINE canonical row 若 schema/default 需要填入 verification_status，
使用既有 compatibility default；不得為了 runtime access 呼叫 roster。
既有 row 的值則保留。Claim 只搬 employee ownership，不做 status
normalization。

## E. Verification code retained but exits runtime

### E.1 保留

- 0003 的 verification_status 欄位、constraint 與
  employee_guest_sessions 重建結果；
- 0004 的 employee_roster table、provenance constraint 與 normalized
  employee unique index；
- employeeVerification.js 中 employee id normalize/validate、same-id
  comparison 與 digest utility，供 audit、legacy tooling 或未來獨立
  workflow 使用；
- 舊 guest session status encoding 與歷史資料 readback；
- public API 的 verificationStatus 欄位；
- admin_audit_log 的歷史 verification metadata；
- historical docs 與先前 atomic claim spec/plan。

### E.2 退出 active runtime

以下不得再影響 active LINE login、registration、binding、claim、
authorization、View As、Admin capability 或 normal application access：

- resolveEmployeeVerification 的 roster query；
- TRUSTED_IMPORT / ADMIN_APPROVED 的 runtime decision；
- verification_status 判斷 registered/provisional；
- isVerifiedPrincipal 作為 Admin、View As 或其他 capability gate；
- PENDING_VERIFICATION / EXISTING_UNVERIFIED_EMPLOYEE 的 LINE onboarding
  branch；
- Admin verification review/approval UI、filter、badge、pending copy；
- 將 claim 後 survivor 的 status 改成 roster-derived VERIFIED/UNVERIFIED。

Employee verification helper 若保留，必須在命名、註解與 tests 明確標示
為 legacy-only；不得讓新 binding/claim code 透過另一個 helper 間接查
employee_roster。

### E.3 Guest boundary

employee_guest 的 UNVERIFIED_EMPLOYEE 可以繼續描述 guest session 的歷史
或 provisional origin。它不再是 LINE canonical authorization status。

guest token 仍不能呼叫 LINE employee bind/claim endpoint，也不能用 stored
role 取得 Admin/ProxyAdmin capability。guest provenance 可以是 historical：
claim evidence 不要求 session 未過期或未 revoke；transfer 的 revoke
只處理當下仍有效且未 revoke 的 matching sessions。

## F. Affected files and deletion / simplification scope

以下是 implementation 後的預期變更範圍；本次只建立 spec，不修改這些檔案。

### F.1 Worker runtime

- worker-poc/src/auth/permissions.js
  - 將 capabilitiesFor、can、assertCan、identityStateFor 改為 active
    LINE + employee binding / guest boundary；移除 verification gate。
  - isVerifiedPrincipal 不再作 runtime authorization；若為保留 export，
    必須標示 deprecated 並不得恢復舊語意。
- worker-poc/src/auth/identity.js
  - actor.registered、provisional、identityState 與 View As eligibility
    不再依 verification_status；只依 auth mode、active、employee id、
    role/capability。
- worker-poc/src/db/users.js
  - 保留 verificationStatus/public field；bound LINE public projection
    不再因 UNVERIFIED 變成 PENDING。
- worker-poc/src/domain/users.js
  - LINE bound user 不走 provisional/UNVERIFIED onboarding branch；
    /api/me 以 active LINE + employee id 回傳 registered。
- worker-poc/src/domain/guestAccess.js
  - normal LINE bind 不查 roster、不改 verification_status；
  - 保留現有 authenticated LINE endpoint、normal bind 與 same-survivor
    idempotence；
  - other-owner branch 僅交給 atomic claim helper。
- worker-poc/src/domain/employeeClaim.js
  - 保留 D1 batch、SQL-level token_hash NOT NULL assertions、dependency/
    concurrency guards、historical provenance、session revoke、audit；
  - 移除 roster query、roster decision、verification_status owner guard
    與 survivor status mutation；
  - 保留 privileged provisional-owner safety guard與 exact decision tree。
- worker-poc/src/domain/employeeVerification.js
  - 保留 normalize/digest/legacy resolver，但 active bind/claim/admin path
    不得呼叫 roster resolver。
- worker-poc/src/domain/adminIdentity.js
  - 保留 Admin employee-binding route；改以 active LINE Admin capability
    授權，不作 verification approval，不查或更新 roster/status。
- worker-poc/src/domain/adminSummary.js、worker-poc/src/routes/*.js
  - 維持 response compatibility，但所有 privileged paths 只信 central
    assertCan；不得新增局部 verification gate。
- worker-poc/migrations-formal/0003_provisional_employee_identity.sql
  與 0004_employee_roster_verification_source.sql
  - 不修改、不刪除、不新增 migration。

### F.2 Frontend runtime/UI

- src/App.jsx、src/auth/bootFlow.js
  - active LINE + employee id 直接進 REGISTERED/application flow；
    PENDING/UNVERIFIED 分支只保留 employee_guest legacy compatibility。
- src/auth/permissions.js
  - UI permissions 只依 auth mode、registered 與 canonical role；不讀
    verificationStatus 作為安全或 navigation gate。
- src/components/LineEmployeeLookup.jsx
  - 保留員編綁定入口；移除「等待人工/roster 核驗」的 active LINE copy。
- src/components/ProvisionalEmployeeOnboarding.jsx
  - 限定 employee_guest legacy onboarding；不顯示 LINE bound pending
    review。
- src/features/balances/identityStatus.js、
  src/components/IdentityStatusBadges.jsx、
  src/features/balances/MemberBalanceManagement.jsx
  - 移除 active pending verification filter/badge/review action；保留
    必要的 legacy field rendering，不讓 UI field 成為 auth boundary。
- src/api/apiErrors.js、src/auth/mockData.js
  - 更新 active copy/fixture；legacy error/status parser 只在仍有 consumer
    時保留。

### F.3 Tests and docs

Worker tests 預期涵蓋 permissions、identity、guest access、employee claim、
admin identity、View As、summary、balance、calendar、roles、
announcements、schema/transaction contracts。

Root tests 預期更新：

- tests/identity-foundation-ui.test.cjs；
- tests/admin-identity-ui.test.cjs；
- tests/strict-identity-ledger.test.cjs；
- tests/changelog-migration.test.cjs。

active architecture/contract docs 預期更新：

- docs/identity-verification-architecture.md；
- worker-poc/docs/canonical-identity-guest-access.md；
- worker-poc/README.md；
- 必要時 docs/react-worker-cutover-matrix.md、CHANGELOG.md、
  src/data/changelog.js。

remote rollout record、先前 claim spec/plan 與其他歷史 evidence 不刪除；
如內容描述舊 active semantics，新增 superseded 標記或在新 architecture
doc 交叉引用，不直接改寫歷史設計紀錄。

## G. Regression plan

### G.1 State and binding

- active LINE + employee_id 直接回傳 registered=true，且不查
  employee_roster。
- active LINE + employee_id=NULL 回傳 EMPLOYEE_BIND_REQUIRED，只能走
  binding/onboarding actions。
- existing normal LINE binding（no owner）維持成功與既有 response shape。
- same survivor / same normalized employee id 是 idempotent success，不
  duplicate claim audit。
- other LINE-bound owner 是 409 EMPLOYEE_ID_ALREADY_BOUND。
- owner line_user_id=NULL 但缺少 historical employee_guest provenance
  是 409，不得 takeover。
- historical matching guest evidence 全部 expired、全部 revoked，仍能
  claim；這些 sessions 不因 claim 被重新寫入。
- matching sessions 中仍 valid/unrevoked 的全部 revoke，包含
  user_id=NULL；expired/revoked rows 保留。

### G.2 Claim safety and atomicity

- current 139653-equivalent fixture：
  - survivor active LINE、role=Admin、verification_status=UNVERIFIED、
    employee_id=NULL；
  - provisional owner active、line_user_id=NULL、role=User、matching
    historical guest evidence、無 business data；
  - claim 後 survivor employee_id=139653、role=Admin、active=1；
  - provisional row active=0、employee_id=NULL、仍保留；
  - matching currently valid sessions revoke；
  - exactly one PROVISIONAL_EMPLOYEE_CLAIMED audit，含 digest/outcome、
    不含 raw token。
- owner verification_status=VERIFIED 或 UNVERIFIED 都不能單獨改變
  claimability；roster never queried。
- privileged provisional owner（Admin/ProxyAdmin）仍 fail closed 409；
  這是 provisional owner safety guard。
- orders、balance_ledger、opening_balance_snapshots、likes、
  idempotency_keys 任一真正 ownership dependency 都回傳
  PROVISIONAL_IDENTITY_HAS_DEPENDENCIES，且所有 transfer side effects
  rollback。
- audit/history reference 單獨存在不阻擋 claim。
- normalized duplicate/ambiguous/competing ownership fail closed。
- preflight 後 survivor 或 owner 被改變時 fail closed，無 partial state。
- test harness 在 transaction 內於 release/retire 後令 assignment guard
  命中 0 rows；只透過 test database/fixture hook 觸發，讓
  token_hash NOT NULL assertion 失敗，驗證 owner employee_id 與 active
  rollback、session 未 revoke、audit 未寫入。
- test-only race trigger/hook 不得進 production employeeClaim helper，
  不得新增 production flag/callback/injection branch。
- 正式 schema regression 確認
  employee_guest_sessions.token_hash 維持 NOT NULL；不可用 assertion
  所依賴的 constraint 被移除或繞過。

### G.3 Authorization

- role=Admin、active LINE、employee_id exists、verification_status=
  UNVERIFIED：
  - /api/me registered=true；
  - Admin/ProxyAdmin central capabilities 正常存在；
  - 至少一個實際 Admin mutation endpoint 成功；
  - 不得因歷史 status 被 403。
- role=ProxyAdmin、active LINE、employee_id exists、verification_status=
  UNVERIFIED：具有現有 ProxyAdmin role action set，不因 status 被擋。
- employee_guest stored role=Admin 或 ProxyAdmin：所有 Admin/ProxyAdmin
  mutation、View As、Admin summary 等 privileged endpoints 仍 403。
- active LINE unbound user：不能直接呼叫 Admin mutation，即使 stored
  role=Admin。
- View As 只由 active LINE canonical role/capability 決定；verification
  status 不參與。
- guest token 呼叫 LINE employee bind/claim endpoint 被既有 LINE auth
  boundary 拒絕且無 mutation。
- route/domain 逐一覆蓋 admin summary、member balance、top-up、calendar、
  role mutation、announcements、Admin employee-binding、View As 與
  其他現有 Admin/ProxyAdmin mutation。

### G.4 Compatibility and UI

- survivor 歷史 verificationStatus=UNVERIFIED 時，/api/me 仍可輸出欄位，
  但 identityState 不為 active PENDING_VERIFICATION，且 application UI
  正常進入。
- status=VERIFIED/identityState=VERIFIED 的 compatibility token 在文件
  與 test assertion 中明確標成 registered token，不測成 roster proof。
- employee_roster 缺資料、inactive、untrusted、ambiguous 都不改變
  active LINE access，也不產生 PENDING review。
- frontend 不顯示 verification review UI/filter/pending copy；不因
  verificationStatus 隱藏已授權的 Admin UI。
- 保留 /api/me authoritative readback、role、authSource、employeeId、
  guest-only boundary 與 existing normal LINE binding regression。

## H. Remote transition strategy

本 spec review 階段不執行任何 remote action。實作與 local verification
通過、且另取得 deployment 授權後，才可依下列順序：

1. 只在 formal Worker repository 建立 implementation commit；CORS 修正
   commit 維持獨立，不 amend、不 push。
2. 以既有 deployment mechanism deploy formal production Worker，保留
   vars/secrets；不 deploy frontend、不 merge main。
3. 使用真正 authenticated LINE flow 呼叫既有
   POST /api/auth/line-employee-bind，不加入任何新 client 欄位。
4. 若 remote 139653 尚未完成 claim，讓正式 atomic claim path 完成
   release/retire/assign/revoke/audit；若已完成，重試只允許 same-survivor
   idempotent readback，不能新增第二筆 merge event。
5. 只做 authoritative read-only verification：
   - survivor active=1、line_user_id 保留、employee_id=139653、
     role=Admin 保留；
   - survivor registered=true、authSource=LINE；
   - verificationStatus 可是歷史 UNVERIFIED，但不應導向
     PENDING_VERIFICATION 或阻擋 Admin；
   - provisional row 保留、active=0、employee_id=NULL；
   - currently valid matching guest sessions 已 revoke；
   - 一筆 PROVISIONAL_EMPLOYEE_CLAIMED 有 digest/outcome 且無 raw token；
   - employee_roster 不被修改。
6. 若 HTTP 回 409/500、出現非 idempotent state、audit/session/ownership
   readback 不一致，立即 STOP。不得 retry destructive cleanup、不得
   手動修 remote D1、不得刪除 provisional row。

Remote smoke 是 manual/external evidence，不能以 local tests 代替。完成
後應分開回報 deployed Worker version、HTTP result、/api/me、D1 readback、
session revoke、audit 與 authorization evidence。

## Review gate

本文件自我檢查的必要結論：

- 新 decision tree 沒有把 line_user_id=NULL 當成 takeover authorization。
- verification_status 與 employee_roster 已從 active registered/authz/
  binding/claim/View As/Admin gate 移除，只保留 legacy compatibility。
- historical employee_guest evidence 不要求未過期或未 revoke。
- unsafe business ownership、duplicate/competition、privileged provisional
  owner 仍 fail closed。
- claim atomicity 仍由 D1 batch + SQL-level NOT NULL assertion 提供，不
  依賴 batch 後 JS meta.changes rollback。
- audit/history reference 不會被誤當作 business dependency。
- migration、remote data、frontend deployment、main merge 均不在本文件
  mutation scope。

請先 review/approve 本 superseding spec；未取得 approval 前不建立新的
implementation plan，也不開始 Task 0–6 implementation。

-- Synthetic conversion contract and controlled formal D1 identity operation.
-- This script never changes users, LINE bindings, orders, ledger rows, or
-- verification status. It only inserts the protected canonical owner mapping,
-- Vendor principal login alias, and the canonical Vendor membership.

INSERT OR IGNORE INTO protected_account_user_mappings (
  account_key, user_id, created_at
)
SELECT 'RESERVED_VENDOR_OWNER', owner.user_id, CURRENT_TIMESTAMP
FROM users owner
WHERE owner.user_id = {{OWNER_USER_ID}}
  AND UPPER(trim(owner.employee_id)) = UPPER(trim({{LEGACY_EMPLOYEE_ID}}))
  AND owner.active = 1
  AND owner.invalid_reason IS NULL
  AND owner.verification_status = 'UNVERIFIED'
  AND length(trim(COALESCE(owner.line_user_id, ''))) > 0
  AND (SELECT COUNT(*) FROM users
       WHERE UPPER(trim(employee_id)) = UPPER(trim({{LEGACY_EMPLOYEE_ID}}))) = 1
  AND (SELECT COUNT(*) FROM vendors WHERE name = {{VENDOR_NAME}} AND enabled = 1) = 1
  AND NOT EXISTS (
    SELECT 1 FROM users
    WHERE UPPER(trim(employee_id)) = {{VENDOR_LOGIN_ID}}
  )
  AND NOT EXISTS (
    SELECT 1 FROM vendor_principals principal
    WHERE UPPER(trim(principal.vendor_login_id)) = {{VENDOR_LOGIN_ID}}
      AND principal.user_id <> owner.user_id
  )
  AND NOT EXISTS (
    SELECT 1 FROM vendor_principals principal
    WHERE principal.user_id = owner.user_id
      AND (principal.principal_role <> 'Vendor'
        OR principal.status <> 'ACTIVE'
        OR (principal.vendor_login_id IS NOT NULL
          AND UPPER(trim(principal.vendor_login_id)) <> {{VENDOR_LOGIN_ID}}))
  )
  AND NOT EXISTS (
    SELECT 1 FROM vendor_memberships membership
    JOIN vendors member_vendor ON member_vendor.vendor_id = membership.vendor_id
    WHERE membership.user_id = owner.user_id
      AND membership.status = 'ACTIVE'
      AND member_vendor.name <> {{VENDOR_NAME}}
  )
  AND NOT EXISTS (
    SELECT 1 FROM vendor_memberships membership
    JOIN vendors member_vendor ON member_vendor.vendor_id = membership.vendor_id
    WHERE membership.user_id = owner.user_id
      AND member_vendor.name = {{VENDOR_NAME}}
      AND membership.status <> 'ACTIVE'
  )
  AND NOT EXISTS (
    SELECT 1 FROM protected_account_user_mappings mapping
    WHERE mapping.account_key = 'RESERVED_VENDOR_OWNER'
      AND mapping.user_id <> owner.user_id
  )
  AND NOT EXISTS (
    SELECT 1 FROM protected_account_user_mappings mapping
    WHERE mapping.user_id = owner.user_id
      AND mapping.account_key <> 'RESERVED_VENDOR_OWNER'
  );

INSERT INTO vendor_principals (
  user_id, vendor_login_id, principal_role, status
)
SELECT owner.user_id, {{VENDOR_LOGIN_ID}}, 'Vendor', 'ACTIVE'
FROM users owner
WHERE owner.user_id = {{OWNER_USER_ID}}
  AND UPPER(trim(owner.employee_id)) = UPPER(trim({{LEGACY_EMPLOYEE_ID}}))
  AND owner.active = 1
  AND owner.invalid_reason IS NULL
  AND owner.role = 'User'
  AND owner.verification_status = 'UNVERIFIED'
  AND length(trim(COALESCE(owner.line_user_id, ''))) > 0
  AND (SELECT COUNT(*) FROM users
       WHERE UPPER(trim(employee_id)) = UPPER(trim({{LEGACY_EMPLOYEE_ID}}))) = 1
  AND (SELECT COUNT(*) FROM vendors WHERE name = {{VENDOR_NAME}} AND enabled = 1) = 1
  AND NOT EXISTS (
    SELECT 1 FROM users
    WHERE UPPER(trim(employee_id)) = {{VENDOR_LOGIN_ID}}
  )
  AND NOT EXISTS (
    SELECT 1 FROM vendor_principals principal
    WHERE UPPER(trim(principal.vendor_login_id)) = {{VENDOR_LOGIN_ID}}
      AND principal.user_id <> owner.user_id
  )
  AND NOT EXISTS (
    SELECT 1 FROM vendor_principals principal
    WHERE principal.user_id = owner.user_id
      AND (principal.principal_role <> 'Vendor'
        OR principal.status <> 'ACTIVE'
        OR (principal.vendor_login_id IS NOT NULL
          AND UPPER(trim(principal.vendor_login_id)) <> {{VENDOR_LOGIN_ID}}))
  )
  AND NOT EXISTS (
    SELECT 1 FROM vendor_memberships membership
    JOIN vendors member_vendor ON member_vendor.vendor_id = membership.vendor_id
    WHERE membership.user_id = owner.user_id
      AND membership.status = 'ACTIVE'
      AND member_vendor.name <> {{VENDOR_NAME}}
  )
  AND NOT EXISTS (
    SELECT 1 FROM vendor_memberships membership
    JOIN vendors member_vendor ON member_vendor.vendor_id = membership.vendor_id
    WHERE membership.user_id = owner.user_id
      AND member_vendor.name = {{VENDOR_NAME}}
      AND membership.status <> 'ACTIVE'
  )
  AND EXISTS (
    SELECT 1 FROM protected_account_user_mappings mapping
    WHERE mapping.account_key = 'RESERVED_VENDOR_OWNER'
      AND mapping.user_id = owner.user_id
  )
ON CONFLICT(user_id) DO UPDATE SET
  vendor_login_id = excluded.vendor_login_id,
  updated_at = CURRENT_TIMESTAMP
WHERE vendor_principals.vendor_login_id IS NULL;

INSERT OR IGNORE INTO vendor_memberships (user_id, vendor_id, status)
SELECT owner.user_id, vendor.vendor_id, 'ACTIVE'
FROM users owner
JOIN vendors vendor ON vendor.name = {{VENDOR_NAME}} AND vendor.enabled = 1
WHERE owner.user_id = {{OWNER_USER_ID}}
  AND UPPER(trim(owner.employee_id)) = UPPER(trim({{LEGACY_EMPLOYEE_ID}}))
  AND owner.active = 1
  AND owner.invalid_reason IS NULL
  AND owner.role = 'User'
  AND owner.verification_status = 'UNVERIFIED'
  AND length(trim(COALESCE(owner.line_user_id, ''))) > 0
  AND (SELECT COUNT(*) FROM users
       WHERE UPPER(trim(employee_id)) = UPPER(trim({{LEGACY_EMPLOYEE_ID}}))) = 1
  AND (SELECT COUNT(*) FROM vendors WHERE name = {{VENDOR_NAME}} AND enabled = 1) = 1
  AND EXISTS (
    SELECT 1 FROM vendor_principals principal
    WHERE principal.user_id = owner.user_id
      AND principal.vendor_login_id = {{VENDOR_LOGIN_ID}}
      AND principal.principal_role = 'Vendor'
      AND principal.status = 'ACTIVE'
  )
  AND EXISTS (
    SELECT 1 FROM protected_account_user_mappings mapping
    WHERE mapping.account_key = 'RESERVED_VENDOR_OWNER'
      AND mapping.user_id = owner.user_id
  )
  AND NOT EXISTS (
    SELECT 1 FROM vendor_memberships membership
    JOIN vendors member_vendor ON member_vendor.vendor_id = membership.vendor_id
    WHERE membership.user_id = owner.user_id
      AND membership.status = 'ACTIVE'
      AND member_vendor.name <> {{VENDOR_NAME}}
  )
  AND NOT EXISTS (
    SELECT 1 FROM vendor_memberships membership
    JOIN vendors member_vendor ON member_vendor.vendor_id = membership.vendor_id
    WHERE membership.user_id = owner.user_id
      AND member_vendor.name = {{VENDOR_NAME}}
      AND membership.status <> 'ACTIVE'
  );

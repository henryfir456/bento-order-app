CREATE TABLE protected_account_access_audit (
  event_id TEXT PRIMARY KEY,
  auth_mode TEXT NOT NULL
    CHECK (auth_mode IN ('line', 'employee_guest')),
  reason_code TEXT NOT NULL
    CHECK (reason_code IN (
      'AUTHORIZATION_UNVERIFIED',
      'EMPLOYEE_LOGIN_FOR_PROTECTED_ACCOUNT',
      'ONBOARDING_FOR_PROTECTED_ACCOUNT',
      'GUEST_SESSION_FOR_PROTECTED_ACCOUNT',
      'LINE_BIND_FOR_PROTECTED_ACCOUNT',
      'PROTECTED_ACCOUNT_MISSING',
      'PROTECTED_ACCOUNT_AMBIGUOUS',
      'PROTECTED_ACCOUNT_INACTIVE',
      'PROTECTED_ACCOUNT_INVALID',
      'PROTECTED_ACCOUNT_UNVERIFIED',
      'LINE_OWNER_MISMATCH',
      'PROTECTED_ACCOUNT_ADMIN_TRANSFER_BLOCKED',
      'PROTECTED_ACCOUNT_VIEW_AS_BLOCKED',
      'PROTECTED_ACCOUNT_CLAIM_BLOCKED',
      'PROTECTED_ACCOUNT_ADMIN_EMPLOYEE_BIND_BLOCKED',
      'PROTECTED_ACCOUNT_ADMIN_REPAIR_PREVIEW_BLOCKED',
      'PROTECTED_ACCOUNT_ADMIN_REPAIR_BLOCKED'
    )),
  occurred_at TEXT NOT NULL
);

CREATE INDEX idx_protected_account_access_audit_time
  ON protected_account_access_audit(occurred_at);

CREATE TRIGGER protected_account_access_audit_no_update
BEFORE UPDATE ON protected_account_access_audit
BEGIN
  SELECT RAISE(ABORT, 'protected account access audit is append-only');
END;

CREATE TRIGGER protected_account_access_audit_no_delete
BEFORE DELETE ON protected_account_access_audit
BEGIN
  SELECT RAISE(ABORT, 'protected account access audit is append-only');
END;

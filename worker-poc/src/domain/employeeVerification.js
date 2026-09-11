import { badRequest } from '../http/errors.js';
import { VERIFICATION_STATUSES } from '../auth/permissions.js';

export const VERIFICATION_DECISIONS = Object.freeze({
  AUTO_VERIFIED: 'AUTO_VERIFIED',
  PENDING_TRUST_REVIEW: 'PENDING_TRUST_REVIEW',
  NO_CHANGE: 'NO_CHANGE'
});

export const TRUSTED_EMPLOYEE_PROVENANCE = Object.freeze([
  'TRUSTED_IMPORT',
  'ADMIN_APPROVED'
]);

export const employeeIdText = (value) => {
  if (typeof value !== 'string') throw badRequest('INVALID_EMPLOYEE_ID');
  const employeeId = value.trim().toUpperCase();
  // Match the trusted import parser's textual contract while using one
  // canonical case for ownership and roster lookups.
  if (!/^[A-Z0-9][A-Z0-9._-]*$/.test(employeeId)) {
    throw badRequest('INVALID_EMPLOYEE_ID');
  }
  return employeeId;
};

export const sameEmployeeId = (left, right) => (
  typeof left === 'string'
  && typeof right === 'string'
  && left.trim().toUpperCase() === right.trim().toUpperCase()
);

const rowsFrom = (result) => (
  Array.isArray(result) ? result : (Array.isArray(result?.results) ? result.results : [])
);

export const resolveEmployeeVerification = async (database, employeeIdInput) => {
  const employeeId = employeeIdText(employeeIdInput);
  const result = await database.prepare(`
    SELECT roster_id, employee_id, active, provenance, source_ref
    FROM employee_roster
    WHERE UPPER(trim(employee_id)) = ?
    ORDER BY roster_id ASC
  `).bind(employeeId).all();
  const matches = rowsFrom(result);
  const trustedMatches = matches.filter((row) => (
    Number(row.active) === 1
    && TRUSTED_EMPLOYEE_PROVENANCE.includes(String(row.provenance || '').trim())
  ));
  if (matches.length === 1 && trustedMatches.length === 1) {
    return {
      employeeId,
      verificationStatus: VERIFICATION_STATUSES.VERIFIED,
      identityState: 'VERIFIED',
      decision: VERIFICATION_DECISIONS.AUTO_VERIFIED,
      reason: 'TRUSTED_UNIQUE_ACTIVE',
      rosterId: String(matches[0].roster_id),
      sourceRef: matches[0].source_ref || null
    };
  }
  return {
    employeeId,
    verificationStatus: VERIFICATION_STATUSES.UNVERIFIED,
    identityState: 'PENDING_VERIFICATION',
    decision: VERIFICATION_DECISIONS.PENDING_TRUST_REVIEW,
    reason: matches.length === 0
      ? 'NO_TRUSTED_MATCH'
      : matches.length > 1
        ? 'AMBIGUOUS_MATCH'
        : 'INACTIVE_OR_UNTRUSTED_MATCH',
    rosterId: null,
    sourceRef: null
  };
};

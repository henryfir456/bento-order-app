import { prepareStatement, randomId, runMutationBatch } from './transactions.js';

export const auditStatement = (database, {
  auditId = randomId('audit'),
  actorUserId,
  actorAuthMode = 'line',
  actorEmployeeIdSnapshot = null,
  actorLineUserIdSnapshot = null,
  targetUserId = null,
  targetEmployeeIdSnapshot = null,
  targetLineUserIdSnapshot = null,
  action,
  metadata = {},
  occurredAt,
  onlyIfPriorMutation = false
}) => prepareStatement(database, onlyIfPriorMutation ? `
  INSERT INTO admin_audit_log (
    audit_id, actor_user_id, actor_auth_mode, actor_employee_id_snapshot,
    actor_line_user_id_snapshot, target_user_id, target_employee_id_snapshot,
    target_line_user_id_snapshot, action, metadata_json, occurred_at
  )
  SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
  WHERE changes() = 1
` : `
  INSERT INTO admin_audit_log (
    audit_id, actor_user_id, actor_auth_mode, actor_employee_id_snapshot,
    actor_line_user_id_snapshot, target_user_id, target_employee_id_snapshot,
    target_line_user_id_snapshot, action, metadata_json, occurred_at
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`, [
  auditId,
  actorUserId,
  actorAuthMode,
  actorEmployeeIdSnapshot,
  actorLineUserIdSnapshot,
  targetUserId,
  targetEmployeeIdSnapshot,
  targetLineUserIdSnapshot,
  action,
  JSON.stringify(metadata),
  occurredAt
]);

export const appendAuditEvent = async (database, input) => {
  const auditId = input.auditId || randomId('audit');
  await runMutationBatch(database, [auditStatement(database, { ...input, auditId })]);
  return auditId;
};

import { prepareStatement, randomId, runMutationBatch } from './transactions.js';

export const auditStatement = (database, {
  auditId = randomId('audit'),
  actorLineUserId,
  targetLineUserId = null,
  action,
  metadata = {},
  occurredAt
}) => prepareStatement(database, `
  INSERT INTO admin_audit_log (
    audit_id, actor_line_user_id, target_line_user_id, action,
    metadata_json, occurred_at
  )
  VALUES (?, ?, ?, ?, ?, ?)
`, [
  auditId,
  actorLineUserId,
  targetLineUserId,
  action,
  JSON.stringify(metadata),
  occurredAt
]);

export const appendAuditEvent = async (database, input) => {
  const auditId = input.auditId || randomId('audit');
  await runMutationBatch(database, [auditStatement(database, { ...input, auditId })]);
  return auditId;
};

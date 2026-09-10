import { ACTIONS, assertCan } from '../auth/permissions.js';
import { auditStatement } from '../db/audit.js';
import {
  getUserByEmployeeId,
  getUserById,
  getUserByLineId,
  publicUser
} from '../db/users.js';
import { prepareStatement, runMutationBatch, resolveClock, randomId } from '../db/transactions.js';
import { badRequest, notFound } from '../http/errors.js';
import { jsonResponse } from '../http/response.js';
import { requireIdentity } from '../http/authMiddleware.js';

const VALID_ROLES = new Set(['User', 'ProxyAdmin', 'Admin']);

const readJson = async (request) => {
  try {
    const value = await request.json();
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('body');
    return value;
  } catch {
    throw badRequest('INVALID_JSON');
  }
};

export const assignRole = async (database, identity, targetUserInput, input, clock = new Date()) => {
  assertCan(identity, ACTIONS.ADMIN_ROLE);
  const targetKey = String(targetUserInput || '').trim();
  const role = String(input?.role || input?.newRole || '').trim();
  if (!targetKey) throw badRequest('ROLE_TARGET_REQUIRED');
  if (!VALID_ROLES.has(role)) throw badRequest('ROLE_INVALID');
  const existing = await getUserById(database, targetKey)
    || await getUserByEmployeeId(database, targetKey)
    || await getUserByLineId(database, targetKey);
  if (!existing) throw notFound('ROLE_TARGET_NOT_FOUND');
  const occurredAt = resolveClock(clock).toISOString();
  const auditId = randomId('audit');
  const update = prepareStatement(database, `
    UPDATE users SET role = ?, updated_at = ? WHERE user_id = ?
  `, [role, occurredAt, existing.userId]);
  const audit = auditStatement(database, {
    auditId,
    actorUserId: identity.actor.userId,
    actorAuthMode: identity.actor.authMode,
    actorEmployeeIdSnapshot: identity.actor.employeeId,
    actorLineUserIdSnapshot: identity.actor.lineUserId,
    targetUserId: existing.userId,
    targetEmployeeIdSnapshot: existing.employeeId,
    targetLineUserIdSnapshot: existing.lineUserId,
    action: 'ROLE_UPDATED',
    metadata: { fromRole: existing.role, toRole: role },
    occurredAt
  });
  await runMutationBatch(database, [update, audit]);
  return {
    success: true,
    message: 'ROLE_UPDATED',
    user: publicUser(await getUserById(database, existing.userId))
  };
};

export const handleRoleRoute = async (request, env, {
  fetchImpl = globalThis.fetch,
  now = new Date()
} = {}) => {
  const url = new URL(request.url);
  const match = request.method === 'PUT'
    ? url.pathname.match(/^\/api\/admin\/users\/([^/]+)\/role$/)
    : null;
  if (!match) return null;
  let target;
  try {
    target = decodeURIComponent(match[1]).trim();
  } catch {
    throw badRequest('ROLE_TARGET_INVALID');
  }
  const identity = await requireIdentity(request, env, {
    fetchImpl,
    allowViewAs: false,
    now
  });
  return jsonResponse(await assignRole(env.DB, identity, target, await readJson(request), now));
};

export { VALID_ROLES };

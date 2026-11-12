import { ACTIONS, assertCan } from '../auth/permissions.js';
import { auditStatement } from '../db/audit.js';
import { prepareStatement, randomId, resolveClock, runMutationBatch } from '../db/transactions.js';
import { HttpError, badRequest, notFound } from '../http/errors.js';

const rowsFrom = (result) => (
  Array.isArray(result) ? result : (Array.isArray(result?.results) ? result.results : [])
);

export const FEEDBACK_CATEGORIES = Object.freeze(['SYSTEM', 'MENU', 'VENDOR', 'OTHER']);
const STATUSES = new Set(['NEW', 'IN_PROGRESS', 'DONE']);
const MESSAGE_LIMIT = 1000;
const TARGET_LIMIT = 60;
const NOTE_LIMIT = 500;
const LIST_LIMIT = 100;
const DAILY_LIMIT = 5;

// Every signed-in member may submit: same gate as reading their own bell
// notifications (self for employees/guests, vendor context for vendors).
const assertCanSubmit = (identity) => assertCan(
  identity,
  identity?.actor?.role === 'Vendor' ? ACTIONS.READ_VENDOR_CONTEXT : ACTIONS.READ_SELF
);

const text = (value) => (typeof value === 'string' ? value.trim() : '');

// Visibility rule: a row is exposed only to its submitter (mine) or to an
// Admin (admin list). The Admin view drops the name when is_anonymous = 1.
const mineView = (row) => ({
  feedbackId: row.feedback_id,
  category: row.category,
  targetName: row.target_name || '',
  rating: row.rating === null || row.rating === undefined ? null : Number(row.rating),
  message: row.message,
  isAnonymous: Number(row.is_anonymous) === 1,
  status: row.status,
  adminNote: row.admin_note || '',
  createdAt: row.created_at,
  handledAt: row.handled_at || null
});

const adminView = (row) => ({
  ...mineView(row),
  submitterName: Number(row.is_anonymous) === 1 ? null : (row.display_name_snapshot || null),
  submitterRole: Number(row.is_anonymous) === 1 ? null : (row.role_snapshot || null)
});

export const createFeedback = async (database, identity, input, now = new Date()) => {
  assertCanSubmit(identity);
  const actor = identity.actor;
  if (!actor?.userId) throw badRequest('FEEDBACK_USER_REQUIRED');
  const category = text(input?.category).toUpperCase();
  if (!FEEDBACK_CATEGORIES.includes(category)) throw badRequest('FEEDBACK_CATEGORY_INVALID');
  const message = text(input?.message);
  if (!message) throw badRequest('FEEDBACK_MESSAGE_REQUIRED');
  if (message.length > MESSAGE_LIMIT) throw badRequest('FEEDBACK_MESSAGE_TOO_LONG');
  const targetName = text(input?.targetName);
  if (targetName.length > TARGET_LIMIT) throw badRequest('FEEDBACK_TARGET_TOO_LONG');
  let rating = null;
  if (input?.rating !== undefined && input?.rating !== null && input?.rating !== '') {
    rating = Number(input.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw badRequest('FEEDBACK_RATING_INVALID');
  }
  const isAnonymous = input?.isAnonymous === true ? 1 : 0;

  const occurredAt = resolveClock(now).toISOString();
  const since = new Date(resolveClock(now).getTime() - 24 * 60 * 60 * 1000).toISOString();
  const recent = await database.prepare(`
    SELECT COUNT(*) AS c FROM feedback_entries WHERE user_id = ? AND created_at >= ?
  `).bind(actor.userId, since).first();
  if (Number(recent?.c || 0) >= DAILY_LIMIT) throw new HttpError(429, 'FEEDBACK_DAILY_LIMIT');

  const feedbackId = randomId('fb');
  await runMutationBatch(database, [prepareStatement(database, `
    INSERT INTO feedback_entries (
      feedback_id, user_id, role_snapshot, display_name_snapshot, category,
      target_name, rating, message, is_anonymous, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    feedbackId, actor.userId, actor.role || '', actor.displayName || '', category,
    targetName, rating, message, isAnonymous, occurredAt, occurredAt
  ])]);
  const row = await database.prepare('SELECT * FROM feedback_entries WHERE feedback_id = ?')
    .bind(feedbackId).first();
  return { success: true, message: 'FEEDBACK_CREATED', feedback: mineView(row) };
};

export const listMyFeedback = async (database, identity) => {
  assertCanSubmit(identity);
  const result = await database.prepare(`
    SELECT * FROM feedback_entries WHERE user_id = ?
    ORDER BY created_at DESC, feedback_id DESC
    LIMIT ${LIST_LIMIT}
  `).bind(identity.actor.userId).all();
  return { success: true, feedback: rowsFrom(result).map(mineView) };
};

export const listAdminFeedback = async (database, identity, { status, category } = {}) => {
  assertCan(identity, ACTIONS.ADMIN_FEEDBACK);
  const statusValue = text(status).toUpperCase();
  const categoryValue = text(category).toUpperCase();
  if (statusValue && !STATUSES.has(statusValue)) throw badRequest('FEEDBACK_STATUS_INVALID');
  if (categoryValue && !FEEDBACK_CATEGORIES.includes(categoryValue)) throw badRequest('FEEDBACK_CATEGORY_INVALID');
  const where = [];
  const params = [];
  if (statusValue) { where.push('status = ?'); params.push(statusValue); }
  if (categoryValue) { where.push('category = ?'); params.push(categoryValue); }
  const result = await database.prepare(`
    SELECT * FROM feedback_entries
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY CASE status WHEN 'NEW' THEN 0 WHEN 'IN_PROGRESS' THEN 1 ELSE 2 END,
      created_at DESC, feedback_id DESC
    LIMIT ${LIST_LIMIT}
  `).bind(...params).all();
  const summary = await database.prepare(`
    SELECT COUNT(*) AS total,
      SUM(CASE WHEN status = 'NEW' THEN 1 ELSE 0 END) AS new_count,
      AVG(rating) AS avg_rating, COUNT(rating) AS rating_count
    FROM feedback_entries
  `).first();
  return {
    success: true,
    feedback: rowsFrom(result).map(adminView),
    summary: {
      total: Number(summary?.total || 0),
      newCount: Number(summary?.new_count || 0),
      ratingCount: Number(summary?.rating_count || 0),
      averageRating: summary?.avg_rating === null || summary?.avg_rating === undefined
        ? null
        : Math.round(Number(summary.avg_rating) * 10) / 10
    }
  };
};

export const updateFeedbackStatus = async (database, identity, feedbackId, input, now = new Date()) => {
  assertCan(identity, ACTIONS.ADMIN_FEEDBACK);
  const actor = identity.actor;
  const status = text(input?.status).toUpperCase();
  if (!STATUSES.has(status)) throw badRequest('FEEDBACK_STATUS_INVALID');
  const note = text(input?.note);
  if (note.length > NOTE_LIMIT) throw badRequest('FEEDBACK_NOTE_TOO_LONG');
  const existing = await database.prepare('SELECT * FROM feedback_entries WHERE feedback_id = ?')
    .bind(feedbackId).first();
  if (!existing) throw notFound('FEEDBACK_NOT_FOUND');
  const occurredAt = resolveClock(now).toISOString();
  await runMutationBatch(database, [
    prepareStatement(database, `
      UPDATE feedback_entries
      SET status = ?, admin_note = ?, handled_by_user_id = ?, handled_at = ?, updated_at = ?
      WHERE feedback_id = ?
    `, [status, note, actor.userId, occurredAt, occurredAt, feedbackId]),
    auditStatement(database, {
      actorUserId: actor.userId,
      actorAuthMode: actor.authMode,
      actorEmployeeIdSnapshot: actor.employeeId,
      actorLineUserIdSnapshot: actor.lineUserId,
      action: 'FEEDBACK_STATUS_UPDATED',
      metadata: { feedbackId, from: existing.status, to: status },
      occurredAt,
      onlyIfPriorMutation: true
    })
  ]);
  const row = await database.prepare('SELECT * FROM feedback_entries WHERE feedback_id = ?')
    .bind(feedbackId).first();
  return { success: true, message: 'FEEDBACK_STATUS_UPDATED', feedback: adminView(row) };
};

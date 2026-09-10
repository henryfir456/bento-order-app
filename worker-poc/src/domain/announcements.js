import { ACTIONS, assertCan } from '../auth/permissions.js';
import { auditStatement } from '../db/audit.js';
import {
  prepareStatement,
  randomId,
  resolveClock,
  runMutationBatch
} from '../db/transactions.js';
import { badRequest, notFound } from '../http/errors.js';
import { getTaipeiDate, isDateOnly } from './deadlines.js';

const rowsFrom = (result) => (
  Array.isArray(result) ? result : (Array.isArray(result?.results) ? result.results : [])
);

const EDITABLE_FIELDS = Object.freeze([
  'title',
  'content',
  'start_date',
  'end_date',
  'enabled'
]);

const editableFieldSet = new Set(EDITABLE_FIELDS);

const text = (value) => (typeof value === 'string' ? value.trim() : '');

const assertKnownFields = (input) => {
  if (Object.keys(input).some((field) => !editableFieldSet.has(field))) {
    throw badRequest('ANNOUNCEMENT_UNKNOWN_FIELD');
  }
};

const requiredText = (value, code) => {
  const normalized = text(value);
  if (!normalized) throw badRequest(code);
  return normalized;
};

const dateValue = (value) => {
  const normalized = text(value);
  if (!isDateOnly(normalized)) throw badRequest('INVALID_DATE');
  return normalized;
};

const enabledValue = (value) => {
  if (typeof value !== 'boolean') throw badRequest('ANNOUNCEMENT_ENABLED_INVALID');
  return value;
};

const assertDateRange = (startDate, endDate) => {
  if (endDate < startDate) throw badRequest('ANNOUNCEMENT_DATE_RANGE_INVALID');
};

const adminAnnouncement = (row) => ({
  id: row.announcement_id,
  title: row.title,
  content: row.content,
  start_date: row.start_date,
  end_date: row.end_date,
  enabled: Number(row.enabled) === 1
});

const getAnnouncementRow = async (database, id) => database.prepare(`
  SELECT announcement_id, title, content, start_date, end_date, enabled, source_order
  FROM announcements
  WHERE announcement_id = ?
`).bind(id).first();

const createInput = (input) => {
  assertKnownFields(input);
  const title = requiredText(input.title, 'ANNOUNCEMENT_TITLE_REQUIRED');
  const content = requiredText(input.content, 'ANNOUNCEMENT_CONTENT_REQUIRED');
  const start_date = dateValue(input.start_date);
  const end_date = dateValue(input.end_date);
  assertDateRange(start_date, end_date);
  const enabled = input.enabled === undefined ? true : enabledValue(input.enabled);
  return { title, content, start_date, end_date, enabled };
};

const patchInput = (input, existing) => {
  assertKnownFields(input);
  if (Object.keys(input).length === 0) throw badRequest('ANNOUNCEMENT_PATCH_EMPTY');

  const patch = {};
  if ('title' in input) patch.title = requiredText(input.title, 'ANNOUNCEMENT_TITLE_REQUIRED');
  if ('content' in input) patch.content = requiredText(input.content, 'ANNOUNCEMENT_CONTENT_REQUIRED');
  if ('start_date' in input) patch.start_date = dateValue(input.start_date);
  if ('end_date' in input) patch.end_date = dateValue(input.end_date);
  if ('enabled' in input) patch.enabled = enabledValue(input.enabled);

  const startDate = patch.start_date || existing.start_date;
  const endDate = patch.end_date || existing.end_date;
  if (!isDateOnly(startDate) || !isDateOnly(endDate)) throw badRequest('INVALID_DATE');
  assertDateRange(startDate, endDate);
  return patch;
};

export const getActiveAnnouncements = async (database, now = new Date()) => {
  const today = getTaipeiDate(now);
  const result = await database.prepare(`
    SELECT announcement_id, title, content, start_date, end_date, enabled, source_order
    FROM announcements
    WHERE enabled = 1
    ORDER BY start_date DESC, source_order DESC
  `).all();
  return rowsFrom(result)
    .filter((row) => (
      isDateOnly(row.start_date)
      && isDateOnly(row.end_date)
      && row.start_date <= today
      && today <= row.end_date
    ))
    .map((row) => ({
      id: row.announcement_id,
      title: row.title,
      content: row.content,
      start_date: row.start_date,
      end_date: row.end_date
    }));
};

export const getAdminAnnouncements = async (database, identity) => {
  assertCan(identity, ACTIONS.ADMIN_ANNOUNCEMENTS);
  const result = await database.prepare(`
    SELECT announcement_id, title, content, start_date, end_date, enabled, source_order
    FROM announcements
    ORDER BY start_date DESC, source_order DESC, announcement_id DESC
  `).all();
  return { announcements: rowsFrom(result).map(adminAnnouncement) };
};

export const createAnnouncement = async (
  database,
  identity,
  input,
  clock = new Date()
) => {
  assertCan(identity, ACTIONS.ADMIN_ANNOUNCEMENTS);
  const values = createInput(input);
  const announcementId = randomId('announcement');
  const occurredAt = resolveClock(clock).toISOString();
  const insert = prepareStatement(database, `
    INSERT INTO announcements (
      announcement_id, title, content, start_date, end_date, enabled,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    announcementId,
    values.title,
    values.content,
    values.start_date,
    values.end_date,
    values.enabled ? 1 : 0,
    occurredAt,
    occurredAt
  ]);
  const audit = auditStatement(database, {
    actorUserId: identity.actor.userId,
    actorAuthMode: identity.actor.authMode,
    actorEmployeeIdSnapshot: identity.actor.employeeId,
    actorLineUserIdSnapshot: identity.actor.lineUserId,
    action: 'ANNOUNCEMENT_CREATED',
    metadata: { announcementId },
    occurredAt
  });
  await runMutationBatch(database, [insert, audit]);
  return adminAnnouncement(await getAnnouncementRow(database, announcementId));
};

export const updateAnnouncement = async (
  database,
  identity,
  announcementId,
  input,
  clock = new Date()
) => {
  assertCan(identity, ACTIONS.ADMIN_ANNOUNCEMENTS);
  const existing = await getAnnouncementRow(database, announcementId);
  if (!existing) throw notFound('ANNOUNCEMENT_NOT_FOUND');
  const patch = patchInput(input, existing);
  const occurredAt = resolveClock(clock).toISOString();
  const assignments = [];
  const bindings = [];
  for (const field of EDITABLE_FIELDS) {
    if (!(field in patch)) continue;
    assignments.push(`${field} = ?`);
    bindings.push(field === 'enabled' ? (patch[field] ? 1 : 0) : patch[field]);
  }
  assignments.push('updated_at = ?');
  bindings.push(occurredAt, announcementId);
  const update = prepareStatement(database, `
    UPDATE announcements
    SET ${assignments.join(', ')}
    WHERE announcement_id = ?
  `, bindings);
  const audit = auditStatement(database, {
    actorUserId: identity.actor.userId,
    actorAuthMode: identity.actor.authMode,
    actorEmployeeIdSnapshot: identity.actor.employeeId,
    actorLineUserIdSnapshot: identity.actor.lineUserId,
    action: 'ANNOUNCEMENT_UPDATED',
    metadata: { announcementId, fields: Object.keys(patch) },
    occurredAt
  });
  await runMutationBatch(database, [update, audit]);
  return adminAnnouncement(await getAnnouncementRow(database, announcementId));
};

export const deleteAnnouncement = async (
  database,
  identity,
  announcementId,
  clock = new Date()
) => {
  assertCan(identity, ACTIONS.ADMIN_ANNOUNCEMENTS);
  const existing = await getAnnouncementRow(database, announcementId);
  if (!existing) throw notFound('ANNOUNCEMENT_NOT_FOUND');
  const occurredAt = resolveClock(clock).toISOString();
  const remove = prepareStatement(database, `
    DELETE FROM announcements WHERE announcement_id = ?
  `, [announcementId]);
  const audit = auditStatement(database, {
    actorUserId: identity.actor.userId,
    actorAuthMode: identity.actor.authMode,
    actorEmployeeIdSnapshot: identity.actor.employeeId,
    actorLineUserIdSnapshot: identity.actor.lineUserId,
    action: 'ANNOUNCEMENT_DELETED',
    metadata: { announcementId },
    occurredAt
  });
  await runMutationBatch(database, [remove, audit]);
};

import { ACTIONS, assertCan } from '../auth/permissions.js';
import { notFound } from '../http/errors.js';
import { getTaipeiDate, isDateOnly } from './deadlines.js';
import { resolveClock } from '../db/transactions.js';

const rowsFrom = (result) => (
  Array.isArray(result) ? result : (Array.isArray(result?.results) ? result.results : [])
);

const parseImages = (value) => {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item) => typeof item === 'string' && item)
      : [];
  } catch {
    return [];
  }
};

const currentAnnouncement = async (database, announcementId, now) => {
  const row = await database.prepare(`
    SELECT announcement_id, title, content, start_date, end_date, enabled,
      image_urls_json, auto_popup_eligible_at
    FROM announcements
    WHERE announcement_id = ?
  `).bind(announcementId).first();
  const today = getTaipeiDate(now);
  if (!row || Number(row.enabled) !== 1
    || !isDateOnly(row.start_date) || !isDateOnly(row.end_date)
    || row.start_date > today || row.end_date < today) {
    throw notFound('ANNOUNCEMENT_NOT_FOUND');
  }
  return row;
};

const getPreference = async (database, userId, announcementId) => database.prepare(`
  SELECT read_at, dismiss_auto_popup_at
  FROM announcement_user_preferences
  WHERE user_id = ? AND announcement_id = ?
`).bind(userId, announcementId).first();

const upsertPreference = async (database, userId, announcementId, field, timestamp) => {
  const statement = field === 'read_at' ? `
    INSERT INTO announcement_user_preferences (
      user_id, announcement_id, read_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (user_id, announcement_id) DO UPDATE SET
      read_at = COALESCE(announcement_user_preferences.read_at, excluded.read_at),
      updated_at = excluded.updated_at
  ` : `
    INSERT INTO announcement_user_preferences (
      user_id, announcement_id, dismiss_auto_popup_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (user_id, announcement_id) DO UPDATE SET
      dismiss_auto_popup_at = COALESCE(
        announcement_user_preferences.dismiss_auto_popup_at,
        excluded.dismiss_auto_popup_at
      ),
      updated_at = excluded.updated_at
  `;
  await database.prepare(statement).bind(
    userId, announcementId, timestamp, timestamp, timestamp
  ).run();
  return getPreference(database, userId, announcementId);
};

export const getAnnouncementInbox = async (database, identity, now = new Date()) => {
  assertCan(identity, ACTIONS.READ_SELF);
  const userId = identity.actor.userId;
  const today = getTaipeiDate(now);
  const nowIso = resolveClock(now).toISOString();
  const result = await database.prepare(`
    SELECT a.announcement_id, a.title, a.content, a.start_date, a.end_date,
      a.image_urls_json, a.auto_popup_eligible_at,
      p.read_at, p.dismiss_auto_popup_at
    FROM announcements a
    LEFT JOIN announcement_user_preferences p
      ON p.announcement_id = a.announcement_id AND p.user_id = ?
    WHERE a.enabled = 1
      AND a.start_date <= ? AND a.end_date >= ?
    ORDER BY a.start_date DESC, a.created_at DESC, a.source_order DESC,
      a.announcement_id DESC
  `).bind(userId, today, today).all();

  const announcements = rowsFrom(result)
    .filter((row) => isDateOnly(row.start_date) && isDateOnly(row.end_date))
    .map((row) => {
      const eligibleAt = row.auto_popup_eligible_at;
      const eligible = typeof eligibleAt === 'string' && eligibleAt !== '' && eligibleAt <= nowIso;
      return {
        id: row.announcement_id,
        title: row.title,
        content: row.content,
        start_date: row.start_date,
        end_date: row.end_date,
        images: parseImages(row.image_urls_json),
        readAt: row.read_at || null,
        dismissAutoPopupAt: row.dismiss_auto_popup_at || null,
        shouldAutoPopup: eligible && !row.dismiss_auto_popup_at
      };
    });

  return {
    success: true,
    unreadCount: announcements.filter((announcement) => !announcement.readAt).length,
    announcements
  };
};

export const markAnnouncementRead = async (
  database,
  identity,
  announcementId,
  now = new Date()
) => {
  assertCan(identity, ACTIONS.READ_SELF);
  await currentAnnouncement(database, announcementId, now);
  const timestamp = resolveClock(now).toISOString();
  const preference = await upsertPreference(
    database, identity.actor.userId, announcementId, 'read_at', timestamp
  );
  return { success: true, announcementId, readAt: preference?.read_at || timestamp };
};

export const dismissAnnouncementAutoPopup = async (
  database,
  identity,
  announcementId,
  now = new Date()
) => {
  assertCan(identity, ACTIONS.READ_SELF);
  const row = await currentAnnouncement(database, announcementId, now);
  const nowIso = resolveClock(now).toISOString();
  if (typeof row.auto_popup_eligible_at !== 'string'
    || !row.auto_popup_eligible_at
    || row.auto_popup_eligible_at > nowIso) {
    throw notFound('ANNOUNCEMENT_NOT_FOUND');
  }
  const preference = await upsertPreference(
    database, identity.actor.userId, announcementId, 'dismiss_auto_popup_at', nowIso
  );
  return {
    success: true,
    announcementId,
    dismissAutoPopupAt: preference?.dismiss_auto_popup_at || nowIso
  };
};

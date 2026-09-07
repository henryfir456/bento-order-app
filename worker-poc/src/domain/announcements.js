import { getTaipeiDate, isDateOnly } from './deadlines.js';

const rowsFrom = (result) => (
  Array.isArray(result) ? result : (Array.isArray(result?.results) ? result.results : [])
);

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

import { isDateOnly } from './deadlines.js';

const rowsFrom = (result) => (
  Array.isArray(result) ? result : (Array.isArray(result?.results) ? result.results : [])
);

export const getLatestMenuVersion = async (database, vendor, targetDate) => {
  if (!vendor || !isDateOnly(targetDate)) return null;
  return database.prepare(`
    SELECT menu_version_id, vendor, effective_date
    FROM menu_versions
    WHERE vendor = ? AND effective_date <= ?
    ORDER BY effective_date DESC
    LIMIT 1
  `).bind(vendor, targetDate).first();
};

export const getCustomerMenu = async (database, { vendor, targetDate }) => {
  const version = await getLatestMenuVersion(database, vendor, targetDate);
  if (!version) return [];
  const result = await database.prepare(`
    SELECT menu_item_id, legacy_item_id, item_name, price, enabled, note, image_url
    FROM menu_items
    WHERE menu_version_id = ? AND enabled = 1
    ORDER BY source_order ASC, menu_item_id ASC
  `).bind(version.menu_version_id).all();
  return rowsFrom(result).map((row) => ({
    menu_item_id: row.menu_item_id,
    item_id: row.legacy_item_id,
    legacy_item_id: row.legacy_item_id,
    item_name: row.item_name,
    price: Number(row.price),
    enabled: Boolean(row.enabled),
    note: row.note || '',
    image_url: row.image_url || ''
  }));
};

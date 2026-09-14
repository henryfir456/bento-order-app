import { isDateOnly } from './deadlines.js';

export const HISTORICAL_MENU_CUTOFF = '2026-09-10';
export const HISTORICAL_MENU_VENDOR = '蔡老師';
export const HISTORICAL_MENU_IMPORTER_VERSION = 'legacy-sql-menu';
export const HISTORICAL_MENU_ITEM_CODE_ALIASES = Object.freeze({ R: 'FR' });

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

export const getHistoricalSqlMenuVersion = async (database, vendor, targetDate) => {
  if (
    vendor !== HISTORICAL_MENU_VENDOR
    || !isDateOnly(targetDate)
    || targetDate > HISTORICAL_MENU_CUTOFF
  ) return null;
  const effectiveMonth = `${targetDate.slice(0, 7)}-01`;
  return database.prepare(`
    SELECT mv.menu_version_id, mv.vendor, mv.effective_date,
           ib.importer_version
    FROM menu_versions mv
    JOIN import_batches ib ON ib.batch_id = mv.source_batch_id
    WHERE mv.vendor = ?
      AND ib.importer_version = ?
      AND mv.effective_date <= ?
    ORDER BY mv.effective_date DESC, mv.menu_version_id DESC
    LIMIT 1
  `).bind(vendor, HISTORICAL_MENU_IMPORTER_VERSION, effectiveMonth).first();
};

export const getReadMenuVersion = async (database, vendor, targetDate) => {
  if (!vendor || !isDateOnly(targetDate)) return null;
  if (targetDate <= HISTORICAL_MENU_CUTOFF && vendor === HISTORICAL_MENU_VENDOR) {
    return getHistoricalSqlMenuVersion(database, vendor, targetDate);
  }
  return getLatestMenuVersion(database, vendor, targetDate);
};

export const getCustomerMenu = async (database, { vendor, targetDate }) => {
  const version = await getReadMenuVersion(database, vendor, targetDate);
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
    selection_key: version.importer_version === HISTORICAL_MENU_IMPORTER_VERSION
      ? row.legacy_item_id
      : row.menu_item_id,
    item_name: row.item_name,
    price: Number(row.price),
    enabled: Boolean(row.enabled),
    note: row.note || '',
    image_url: row.image_url || ''
  }));
};

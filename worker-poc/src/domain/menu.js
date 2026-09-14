import { isDateOnly } from './deadlines.js';
import {
  HISTORICAL_MENU_CUTOFF,
  HISTORICAL_MENU_IMPORTER_VERSION,
  HISTORICAL_MENU_VENDOR,
  resolveMenuItemChanges
} from './menuItemChanges.js';

export {
  HISTORICAL_MENU_CUTOFF,
  HISTORICAL_MENU_IMPORTER_VERSION,
  HISTORICAL_MENU_VENDOR
};

export const HISTORICAL_MENU_ITEM_CODE_ALIASES = Object.freeze({ R: 'FR' });

const rowsFrom = (result) => (
  Array.isArray(result) ? result : (Array.isArray(result?.results) ? result.results : [])
);

export const getLatestMenuVersion = async (database, vendor, targetDate) => {
  if (!vendor || !isDateOnly(targetDate)) return null;
  return database.prepare(`
    SELECT menu_version_id, vendor, effective_date, source_batch_id
    FROM menu_versions
    WHERE vendor = ? AND effective_date <= ?
    ORDER BY effective_date DESC, menu_version_id DESC
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
           ib.importer_version, mv.source_batch_id
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

const directMenuRows = async (database, version) => {
  if (!version) return [];
  const result = await database.prepare(`
    SELECT menu_item_id, legacy_item_id, variant_key, item_name, price,
           enabled, note, image_url, source_order
    FROM menu_items
    WHERE menu_version_id = ? AND enabled = 1
    ORDER BY source_order ASC, menu_item_id ASC
  `).bind(version.menu_version_id).all();
  return rowsFrom(result);
};

const menuItemFromResolvedChange = (change, compatibilityRows, isHistorical) => {
  const matchingRows = compatibilityRows.filter((row) => (
    String(row.legacy_item_id) === change.item_code
      && String(row.variant_key || '') === change.variant_key
  ));
  const compatibility = matchingRows.length === 1 ? matchingRows[0] : null;
  const menuItemId = compatibility?.menu_item_id || change.menu_item_id;
  return {
    menu_item_id: menuItemId,
    item_id: isHistorical ? change.item_code : menuItemId,
    legacy_item_id: change.item_code,
    variant_key: change.variant_key,
    selection_key: isHistorical ? change.item_code : menuItemId,
    item_name: change.item_name,
    price: change.price,
    enabled: change.enabled,
    note: change.note,
    image_url: change.image_url
  };
};

const menuFromChanges = async (database, { vendor, targetDate, resolution }) => {
  if (!resolution.rows.length) return null;
  const isHistorical = resolution.authority === 'sql_historical';
  const version = await getReadMenuVersion(database, vendor, targetDate);
  const compatibilityRows = await directMenuRows(database, version);
  return resolution.rows
    .filter((change) => change.enabled)
    .map((change) => menuItemFromResolvedChange(change, compatibilityRows, isHistorical));
};

export const getCustomerMenu = async (
  database,
  { vendor, targetDate } = {}
) => {
  const resolution = await resolveMenuItemChanges(database, { vendor, targetDate });
  const fromChanges = await menuFromChanges(database, { vendor, targetDate, resolution });
  if (fromChanges) return fromChanges;

  // Compatibility fallback is intentional during the staged cutover. Once
  // SQL/GAS backfill and the future projection exist, this branch is unused;
  // it keeps existing snapshots readable before the new source is populated.
  const version = await getReadMenuVersion(database, vendor, targetDate);
  const menuRows = await directMenuRows(database, version);
  return menuRows.map((row) => ({
    menu_item_id: row.menu_item_id,
    item_id: row.legacy_item_id,
    legacy_item_id: row.legacy_item_id,
    variant_key: row.variant_key || '',
    selection_key: version?.importer_version === HISTORICAL_MENU_IMPORTER_VERSION
      ? row.legacy_item_id
      : row.menu_item_id,
    item_name: row.item_name,
    price: Number(row.price),
    enabled: Boolean(row.enabled),
    note: row.note || '',
    image_url: row.image_url || ''
  }));
};

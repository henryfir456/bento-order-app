import { isDateOnly } from './deadlines.js';
import {
  HISTORICAL_MENU_CUTOFF,
  HISTORICAL_MENU_IMPORTER_VERSION,
  HISTORICAL_MENU_VENDOR,
  resolveEffectiveMenuState
} from './menuItemChanges.js';
import {
  compatibilityVendorCandidates,
  historicalMenuRowVendorCandidates,
  isHistoricalMenuVendor,
  normalizeMenuVendor
} from './menuVendors.js';

export {
  HISTORICAL_MENU_CUTOFF,
  HISTORICAL_MENU_IMPORTER_VERSION,
  HISTORICAL_MENU_VENDOR
};

export const HISTORICAL_MENU_ITEM_CODE_ALIASES = Object.freeze({ R: 'FR' });

export const getLatestMenuVersion = async (database, vendor, targetDate) => {
  const normalizedVendor = normalizeMenuVendor(vendor);
  if (!normalizedVendor || !isDateOnly(targetDate)) return null;
  const vendors = compatibilityVendorCandidates(normalizedVendor);
  const placeholders = vendors.map(() => '?').join(', ');
  return database.prepare(`
    SELECT menu_version_id, vendor, effective_date, source_batch_id
    FROM menu_versions
    WHERE vendor IN (${placeholders}) AND effective_date <= ?
    ORDER BY effective_date DESC, menu_version_id DESC
    LIMIT 1
  `).bind(...vendors, targetDate).first();
};

export const getHistoricalSqlMenuVersion = async (database, vendor, targetDate) => {
  const normalizedVendor = normalizeMenuVendor(vendor);
  if (
    !isHistoricalMenuVendor(normalizedVendor)
    || !isDateOnly(targetDate)
    || targetDate > HISTORICAL_MENU_CUTOFF
  ) return null;
  const vendors = historicalMenuRowVendorCandidates(normalizedVendor);
  const placeholders = vendors.map(() => '?').join(', ');
  const effectiveMonth = `${targetDate.slice(0, 7)}-01`;
  return database.prepare(`
    SELECT mv.menu_version_id, mv.vendor, mv.effective_date,
           ib.importer_version, mv.source_batch_id
    FROM menu_versions mv
    JOIN import_batches ib ON ib.batch_id = mv.source_batch_id
    WHERE mv.vendor IN (${placeholders})
      AND ib.importer_version = ?
      AND mv.effective_date <= ?
    ORDER BY mv.effective_date DESC, mv.menu_version_id DESC
    LIMIT 1
  `).bind(...vendors, HISTORICAL_MENU_IMPORTER_VERSION, effectiveMonth).first();
};

export const getReadMenuVersion = async (database, vendor, targetDate) => {
  const normalizedVendor = normalizeMenuVendor(vendor);
  if (!normalizedVendor || !isDateOnly(targetDate)) return null;
  if (targetDate <= HISTORICAL_MENU_CUTOFF && isHistoricalMenuVendor(normalizedVendor)) {
    return getHistoricalSqlMenuVersion(database, normalizedVendor, targetDate);
  }
  return getLatestMenuVersion(database, normalizedVendor, targetDate);
};

const menuItemFromResolvedChange = (change, compatibilityRows, isHistorical) => {
  const matchingRows = compatibilityRows.filter((row) => (
    String(row.item_code ?? row.legacy_item_id) === change.item_code
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
    image_url: change.display_image_url || change.image_url
  };
};

const menuItemFromCompatibilityBaseline = (row, isHistorical) => ({
  menu_item_id: row.menu_item_id,
  item_id: row.item_code,
  legacy_item_id: row.item_code,
  variant_key: row.variant_key,
  selection_key: isHistorical ? row.item_code : row.menu_item_id,
  item_name: row.item_name,
  price: row.price,
  enabled: row.enabled,
  note: row.note,
  image_url: row.display_image_url || row.image_url
});

const menuFromChanges = (resolution) => {
  const rows = resolution.rows.length ? resolution.rows : resolution.baselineRows;
  if (!rows.length) return null;
  const isHistorical = resolution.authority === 'sql_historical';
  return rows
    .filter((change) => change.enabled)
    .map((change) => change.source_kind === 'compatibility_baseline'
      ? menuItemFromCompatibilityBaseline(change, isHistorical)
      : menuItemFromResolvedChange(change, resolution.baselineRows, isHistorical));
};

export const getCustomerMenu = async (
  database,
  { vendor, targetDate } = {}
) => {
  const resolution = await resolveEffectiveMenuState(database, { vendor, targetDate });
  const fromChanges = menuFromChanges(resolution);
  if (fromChanges) return fromChanges;
  return [];
};

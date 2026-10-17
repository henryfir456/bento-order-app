import { getCustomerMenu } from './menu.js';
import { normalizeMenuVendor } from './menuVendors.js';
import { isDateOnly } from './deadlines.js';

export const EFFECTIVE_ORDER_ITEM_NAME_ALIASES = Object.freeze({
  '番茄鷹豆泥': '蕃茄鷹豆泥',
  'C.每日特餐': 'C.特餐',
  '特餐': 'C.特餐',
  '風味便當': 'A.風味便當'
});

const text = (value) => String(value ?? '').trim();
const itemNameFor = (item) => typeof item?.item_name_snapshot === 'string'
  ? item.item_name_snapshot
  : String(item?.item_name ?? '');
const priceFor = (item) => {
  const value = Number(item?.unit_price ?? item?.price);
  return Number.isFinite(value) ? value : null;
};
const identity = (...parts) => JSON.stringify(parts.map((part) => String(part ?? '')));

const isEnabled = (menuItem) => menuItem?.enabled !== false && Number(menuItem?.enabled ?? 1) !== 0;

/**
 * Resolve one immutable order snapshot against the effective menu already
 * loaded for that order's vendor and date. Any missing or ambiguous match
 * returns the original snapshot and a vendor-scoped fallback identity.
 */
export const resolveEffectiveOrderItemName = ({
  vendor,
  orderDate,
  item,
  menuItems = []
} = {}) => {
  const originalName = itemNameFor(item);
  const normalizedVendor = normalizeMenuVendor(vendor) || text(vendor) || '未命名店家';
  const catalog = (Array.isArray(menuItems) ? menuItems : []).filter((menuItem) => (
    isEnabled(menuItem)
      && (!text(menuItem?.vendor) || normalizeMenuVendor(menuItem.vendor) === normalizedVendor)
  ));
  const menuItemId = text(item?.menu_item_id);
  const legacyItemId = text(item?.legacy_item_id || item?.item_id);
  const unitPrice = priceFor(item);
  const requestedVariant = text(item?.variant_key);
  const hasStableIdentity = item?.stable_identity === true;

  const fallback = ({ separate = false } = {}) => ({
    itemName: originalName,
    // If identity cannot be established, keep this exact order line separate
    // so two ambiguous variants with identical snapshots are never merged.
    identityKey: identity(
      normalizedVendor,
      'snapshot',
      menuItemId,
      legacyItemId,
      requestedVariant,
      unitPrice,
      originalName,
      separate ? text(item?.fallbackKey) : ''
    ),
    vendor: normalizedVendor,
    variantKey: requestedVariant,
    resolved: false,
    orderDate
  });
  if (item?.stable_identity_vendor_mismatch === true
    || item?.stable_identity_mismatch === true) return fallback({ separate: true });

  let matches = menuItemId
    ? catalog.filter((candidate) => text(candidate?.menu_item_id) === menuItemId)
    : [];
  let ambiguous = matches.length > 1;
  if (matches.length !== 1) {
    const sameLegacyIdentity = legacyItemId
      ? catalog.filter((candidate) => text(candidate?.legacy_item_id || candidate?.item_id) === legacyItemId)
      : [];
    const identityMatches = sameLegacyIdentity.filter((candidate) => (
      (hasStableIdentity || unitPrice === null || Number(candidate?.price) === unitPrice)
        && (!requestedVariant || text(candidate?.variant_key) === requestedVariant)
    ));
    ambiguous ||= !requestedVariant
      && new Set(identityMatches.map((candidate) => text(candidate?.variant_key))).size > 1;
    matches = ambiguous ? [] : identityMatches;
  }
  if (matches.length !== 1 && !hasStableIdentity && !ambiguous) {
    const mappedName = EFFECTIVE_ORDER_ITEM_NAME_ALIASES[originalName];
    if (mappedName) {
      matches = catalog.filter((candidate) => (
        text(candidate?.item_name) === mappedName
          && (unitPrice === null || Number(candidate?.price) === unitPrice)
          && (!requestedVariant || text(candidate?.variant_key) === requestedVariant)
      ));
    } else if (!legacyItemId) {
      matches = catalog.filter((candidate) => (
        text(candidate?.item_name) === originalName
          && (unitPrice === null || Number(candidate?.price) === unitPrice)
          && (!requestedVariant || text(candidate?.variant_key) === requestedVariant)
      ));
    }
    ambiguous ||= matches.length > 1;
  }

  if (matches.length !== 1) return fallback({ separate: ambiguous || matches.length > 1 });

  const resolved = matches[0];
  const variantKey = text(resolved.variant_key || requestedVariant);
  const stableCode = text(resolved.legacy_item_id || resolved.item_id);
  const stableId = stableCode
    ? identity(normalizedVendor, 'menu', stableCode, variantKey)
    : identity(normalizedVendor, 'menu-id', resolved.menu_item_id);
  return {
    itemName: text(resolved.item_name) || originalName,
    identityKey: stableId,
    vendor: normalizedVendor,
    variantKey,
    resolved: true,
    orderDate
  };
};

/** Cache effective vendor/date menus while resolving any number of snapshots. */
export const createEffectiveOrderItemNameResolver = (database) => {
  const menus = new Map();
  const historicalIdentities = new Map();
  return async ({ vendor, orderDate, item } = {}) => {
    const normalizedVendor = normalizeMenuVendor(vendor) || text(vendor);
    const cacheKey = identity(normalizedVendor, orderDate);
    let sourceItem = { ...item };
    const menuItemId = text(item?.menu_item_id);
    if (menuItemId) {
      if (!historicalIdentities.has(menuItemId)) {
        historicalIdentities.set(menuItemId, database.prepare(`
          SELECT mv.vendor, mi.legacy_item_id, mi.variant_key
          FROM menu_items mi
          JOIN menu_versions mv ON mv.menu_version_id = mi.menu_version_id
          WHERE mi.menu_item_id = ?
          LIMIT 1
        `).bind(menuItemId).first());
      }
      const stableIdentity = await historicalIdentities.get(menuItemId);
      if (stableIdentity) {
        const snapshotLegacyId = text(sourceItem.legacy_item_id || sourceItem.item_id);
        const storedLegacyId = text(stableIdentity.legacy_item_id);
        const snapshotVariant = text(sourceItem.variant_key);
        const storedVariant = text(stableIdentity.variant_key);
        if (normalizeMenuVendor(stableIdentity.vendor) !== normalizedVendor
          || (snapshotLegacyId && snapshotLegacyId !== storedLegacyId)
          || (snapshotVariant && snapshotVariant !== storedVariant)) {
          sourceItem = { ...sourceItem, stable_identity_mismatch: true };
        } else {
          sourceItem = {
            ...sourceItem,
            legacy_item_id: sourceItem.legacy_item_id || stableIdentity.legacy_item_id,
            variant_key: sourceItem.variant_key || stableIdentity.variant_key || '',
            stable_identity: true
          };
        }
      }
    }
    if (!normalizedVendor || !isDateOnly(orderDate)) {
      return resolveEffectiveOrderItemName({ vendor: normalizedVendor, orderDate, item: sourceItem });
    }
    if (!menus.has(cacheKey)) {
      menus.set(cacheKey, getCustomerMenu(database, { vendor: normalizedVendor, targetDate: orderDate }));
    }
    const menuItems = await menus.get(cacheKey);
    return resolveEffectiveOrderItemName({ vendor: normalizedVendor, orderDate, item: sourceItem, menuItems });
  };
};

import { getCustomerMenu } from './menu.js';
import { normalizeMenuVendor } from './menuVendors.js';
import { isDateOnly } from './deadlines.js';

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
  const hasVendor = Boolean(normalizeMenuVendor(vendor) || text(vendor));
  const catalog = (Array.isArray(menuItems) ? menuItems : []).filter((menuItem) => (
    isEnabled(menuItem)
      && (!text(menuItem?.vendor) || normalizeMenuVendor(menuItem.vendor) === normalizedVendor)
  ));
  const menuItemId = text(item?.menu_item_id);
  const legacyItemId = text(item?.legacy_item_id || item?.item_id);
  const unitPrice = priceFor(item);
  const requestedVariant = text(item?.variant_key);
  const hasStableIdentity = item?.stable_identity === true;

  const fallback = ({ resolutionStatus = 'not_found' } = {}) => ({
    itemName: originalName,
    // An unresolved snapshot has no verified stable identity. Keep the exact
    // order line separate so identical labels cannot merge unrelated meals.
    identityKey: identity(
      normalizedVendor,
      'snapshot',
      menuItemId,
      legacyItemId,
      requestedVariant,
      unitPrice,
      originalName,
      text(item?.fallbackKey)
    ),
    vendor: normalizedVendor,
    variantKey: requestedVariant,
    itemCode: legacyItemId,
    resolved: false,
    resolutionStatus,
    orderDate
  });
  if (!hasVendor || !isDateOnly(orderDate)) return fallback({ resolutionStatus: 'missing_context' });
  if (item?.stable_identity_vendor_mismatch === true
    || item?.stable_identity_mismatch === true) {
    return fallback({ resolutionStatus: 'identity_mismatch' });
  }

  let matches = [];
  let ambiguous = false;
  if (menuItemId) {
    const directMatches = catalog.filter((candidate) => text(candidate?.menu_item_id) === menuItemId);
    const verifiedDirectMatches = directMatches.filter((candidate) => (
      (!legacyItemId || text(candidate?.legacy_item_id || candidate?.item_id) === legacyItemId)
        && (!requestedVariant || text(candidate?.variant_key) === requestedVariant)
    ));
    if (directMatches.length > 0 && verifiedDirectMatches.length !== directMatches.length) {
      return fallback({ resolutionStatus: 'identity_mismatch' });
    }
    matches = verifiedDirectMatches;
    ambiguous = matches.length > 1;
  }
  if (matches.length !== 1) {
    const sameLegacyIdentity = legacyItemId
      ? catalog.filter((candidate) => text(candidate?.legacy_item_id || candidate?.item_id) === legacyItemId)
      : [];
    const sameVariantIdentity = sameLegacyIdentity.filter((candidate) => (
      !requestedVariant || text(candidate?.variant_key) === requestedVariant
    ));
    ambiguous ||= sameVariantIdentity.length > 1;
    const identityMatches = sameVariantIdentity.filter((candidate) => (
      hasStableIdentity || unitPrice === null || Number(candidate?.price) === unitPrice
    ));
    matches = ambiguous ? [] : identityMatches;
  }
  if (matches.length !== 1) {
    // Names and prices alone are not identity evidence. Keep the snapshot
    // unresolved until a menu item ID or legacy item ID verifies the match.
    return fallback({ resolutionStatus: ambiguous || matches.length > 1 ? 'ambiguous' : 'not_found' });
  }

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
    itemCode: stableCode || text(resolved.menu_item_id),
    resolved: true,
    resolutionStatus: 'resolved',
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

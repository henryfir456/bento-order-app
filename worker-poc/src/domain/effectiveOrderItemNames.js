import { getCustomerMenu, HISTORICAL_MENU_ITEM_CODE_ALIASES } from './menu.js';
import {
  legacyItemHasHalfVariant,
  normalizeLegacyMenuIdentity,
  prefetchCompatibilityMenuBaselines,
  prefetchMenuItemChanges
} from './menuItemChanges.js';
import { normalizeMenuVendor } from './menuVendors.js';
import { isDateOnly } from './deadlines.js';

const text = (value) => String(value ?? '').trim();
const canonicalLegacyItemId = (value) => {
  const code = text(value);
  return HISTORICAL_MENU_ITEM_CODE_ALIASES[code] || code;
};
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
  const canonicalItemId = canonicalLegacyItemId(legacyItemId);
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
    orderDate,
    ...(item?.stored_menu_identity ? { storedMenuIdentity: item.stored_menu_identity } : {})
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
      (!canonicalItemId || canonicalLegacyItemId(candidate?.legacy_item_id || candidate?.item_id) === canonicalItemId)
        && (!requestedVariant || text(candidate?.variant_key) === requestedVariant)
    ));
    if (directMatches.length > 0 && verifiedDirectMatches.length !== directMatches.length) {
      return fallback({ resolutionStatus: 'identity_mismatch' });
    }
    matches = verifiedDirectMatches;
    ambiguous = matches.length > 1;
  }
  if (matches.length !== 1) {
    const sameLegacyIdentity = canonicalItemId
      ? catalog.filter((candidate) => canonicalLegacyItemId(candidate?.legacy_item_id || candidate?.item_id) === canonicalItemId)
      : [];
    const sameVariantIdentity = sameLegacyIdentity.filter((candidate) => (
      !requestedVariant || text(candidate?.variant_key) === requestedVariant
    ));
    ambiguous ||= sameVariantIdentity.length > 1;
    const identityMatches = sameVariantIdentity.filter((candidate) => (
      hasStableIdentity || unitPrice === null || Number(candidate?.price) === unitPrice
    ));
    matches = ambiguous ? [] : identityMatches;
    if ((ambiguous || matches.length === 0) && hasStableIdentity && !requestedVariant) {
      // The order's own menu item (verified by its stored ID) predates a split of
      // this code into explicit variants. Use only the reviewed legacy mapping,
      // never the label or price, to pick the matching variant.
      const mapped = normalizeLegacyMenuIdentity({ vendor: normalizedVendor, itemCode: legacyItemId });
      const narrowed = mapped
        ? catalog.filter((candidate) => (
          canonicalLegacyItemId(candidate?.legacy_item_id || candidate?.item_id) === mapped.item_code
            && text(candidate?.variant_key) === mapped.variant_key
        ))
        : [];
      if (narrowed.length === 1) {
        matches = narrowed;
        ambiguous = false;
      }
    }
  }
  if (matches.length !== 1) {
    // Names and prices alone are not identity evidence. Keep the snapshot
    // unresolved until a menu item ID or legacy item ID verifies the match.
    return fallback({ resolutionStatus: ambiguous || matches.length > 1 ? 'ambiguous' : 'not_found' });
  }

  const resolved = matches[0];
  const stableCode = canonicalLegacyItemId(resolved.legacy_item_id || resolved.item_id);
  let variantKey = text(resolved.variant_key || requestedVariant);
  if (!variantKey && stableCode) {
    // A menu row from before the variant split has no variant. When the reviewed
    // mapping keeps the same code and only adds a variant, group it with that
    // variant's normalized rows so one dish is not counted under two identities.
    const mapped = normalizeLegacyMenuIdentity({ vendor: normalizedVendor, itemCode: stableCode });
    if (mapped && mapped.item_code === stableCode) variantKey = mapped.variant_key;
  }
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

/**
 * Footprint statistics only (never Admin summaries or vendor settlement): an
 * unresolved order line whose snapshot code is a dish's base code is counted
 * as that dish's HALF (半飯) variant when either
 * - its own stored menu item is that dish's HALF item (identity_mismatch), or
 * - it has no menu item ID and its snapshot name says 半飯,
 * and the reviewed legacy mapping says the dish has a HALF variant. Returns the
 * same identity key a verified HALF menu item gets, or null.
 */
export const footprintHalfRiceIdentity = (effectiveItem, item = {}) => {
  if (!effectiveItem || effectiveItem.resolved !== false) return null;
  const vendor = effectiveItem.vendor;
  const base = normalizeLegacyMenuIdentity({
    vendor,
    itemCode: canonicalLegacyItemId(item?.legacy_item_id || item?.item_id)
  });
  if (!base || base.variant_key !== 'BASE'
    || !legacyItemHasHalfVariant({ vendor, itemCode: base.item_code })) return null;
  let evidence = null;
  const stored = effectiveItem.storedMenuIdentity;
  if (effectiveItem.resolutionStatus === 'identity_mismatch' && stored
    && normalizeMenuVendor(stored.vendor) === vendor) {
    const storedIdentity = normalizeLegacyMenuIdentity({
      vendor,
      itemCode: stored.legacyItemId,
      variantKey: stored.variantKey
    });
    if (storedIdentity?.item_code === base.item_code && storedIdentity.variant_key === 'HALF') {
      evidence = 'menu_item';
    }
  } else if (!text(item?.menu_item_id) && itemNameFor(item).includes('半飯')) {
    evidence = 'name';
  }
  if (!evidence) return null;
  return {
    identityKey: identity(vendor, 'menu', base.item_code, 'HALF'),
    itemCode: base.item_code,
    variantKey: 'HALF',
    evidence
  };
};

// D1 allows at most 100 bound parameters per statement.
const IDENTITY_BATCH_SIZE = 50;

/** Cache effective vendor/date menus while resolving any number of snapshots. */
export const createEffectiveOrderItemNameResolver = (database) => {
  const menus = new Map();
  const historicalIdentities = new Map();
  const readCache = new Map();
  const loadMenu = (normalizedVendor, orderDate) => getCustomerMenu(database, {
    vendor: normalizedVendor,
    targetDate: orderDate,
    readCache,
    // Name resolution never reads image URLs, so skip the image fallback read.
    includeDisplayImages: false
  });
  const resolve = async ({ vendor, orderDate, item } = {}) => {
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
        const snapshotLegacyId = canonicalLegacyItemId(sourceItem.legacy_item_id || sourceItem.item_id);
        const storedLegacyId = canonicalLegacyItemId(stableIdentity.legacy_item_id);
        const snapshotVariant = text(sourceItem.variant_key);
        const storedVariant = text(stableIdentity.variant_key);
        if (normalizeMenuVendor(stableIdentity.vendor) !== normalizedVendor
          || (snapshotLegacyId && snapshotLegacyId !== storedLegacyId)
          || (snapshotVariant && snapshotVariant !== storedVariant)) {
          sourceItem = {
            ...sourceItem,
            stable_identity_mismatch: true,
            stored_menu_identity: {
              vendor: text(stableIdentity.vendor),
              legacyItemId: text(stableIdentity.legacy_item_id),
              variantKey: text(stableIdentity.variant_key)
            }
          };
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
      menus.set(cacheKey, loadMenu(normalizedVendor, orderDate));
    }
    const menuItems = await menus.get(cacheKey);
    return resolveEffectiveOrderItemName({ vendor: normalizedVendor, orderDate, item: sourceItem, menuItems });
  };

  /**
   * Warm the per-request caches for many snapshots at once: one batched read
   * for stable item identities, then the distinct vendor/date menus. Results
   * are identical to resolving lazily; it only removes sequential D1 round trips.
   */
  resolve.prefetch = async (entries = []) => {
    const menuItemIds = [...new Set(entries
      .map((entry) => text(entry?.item?.menu_item_id))
      .filter((id) => id && !historicalIdentities.has(id)))];
    const identityBatches = [];
    for (let index = 0; index < menuItemIds.length; index += IDENTITY_BATCH_SIZE) {
      const ids = menuItemIds.slice(index, index + IDENTITY_BATCH_SIZE);
      const batch = database.prepare(`
        SELECT mi.menu_item_id, mv.vendor, mi.legacy_item_id, mi.variant_key
        FROM menu_items mi
        JOIN menu_versions mv ON mv.menu_version_id = mi.menu_version_id
        WHERE mi.menu_item_id IN (${ids.map(() => '?').join(', ')})
      `).bind(...ids).all().then((result) => {
        const rows = Array.isArray(result?.results) ? result.results : [];
        return new Map(rows.map((row) => [text(row.menu_item_id), row]));
      });
      // A failed batch rejects through the awaited call below; mark the derived
      // per-ID promises handled so they do not also surface as unhandled.
      ids.forEach((id) => {
        const identityRow = batch.then((rows) => rows.get(id) ?? null);
        identityRow.catch(() => {});
        historicalIdentities.set(id, identityRow);
      });
      identityBatches.push(batch);
    }
    const pairs = new Map();
    entries.forEach((entry) => {
      const normalizedVendor = normalizeMenuVendor(entry?.vendor) || text(entry?.vendor);
      if (!normalizedVendor || !isDateOnly(entry?.orderDate)) return;
      pairs.set(identity(normalizedVendor, entry.orderDate), [normalizedVendor, entry.orderDate]);
    });
    const pendingPairs = [...pairs.entries()].filter(([key]) => !menus.has(key));
    // Identities, change rows and menu versions are independent reads, so run
    // them concurrently; each sequential D1 round trip adds network latency.
    await Promise.all([
      ...identityBatches,
      prefetchMenuItemChanges(database, pendingPairs.map(([, [normalizedVendor]]) => normalizedVendor), readCache),
      prefetchCompatibilityMenuBaselines(database, pendingPairs
        .map(([, [normalizedVendor, orderDate]]) => ({ vendor: normalizedVendor, targetDate: orderDate })), readCache)
    ]);
    await Promise.all([...pairs.entries()].map(([key, [normalizedVendor, orderDate]]) => {
      if (!menus.has(key)) menus.set(key, loadMenu(normalizedVendor, orderDate));
      return menus.get(key);
    }));
  };
  return resolve;
};

import { ACTIONS, assertCan } from '../auth/permissions.js';
import { auditStatement } from '../db/audit.js';
import {
  prepareStatement,
  randomId,
  resolveClock,
  runMutationBatch
} from '../db/transactions.js';
import { badRequest, conflict, forbidden, notFound } from '../http/errors.js';
import { isDateOnly } from './deadlines.js';
import {
  CANONICAL_HE_SHI_VENDOR,
  HISTORICAL_SQL_VENDOR,
  canonicalMenuRowVendor,
  compatibilityVendorCandidates,
  historicalMenuRowVendorCandidates,
  isHistoricalMenuVendor,
  normalizeMenuItemName,
  normalizeMenuVendor
} from './menuVendors.js';

export const HISTORICAL_MENU_CUTOFF = '2026-09-10';
export const HISTORICAL_MENU_VENDOR = HISTORICAL_SQL_VENDOR;
export const HE_SHI_MENU_VENDOR = CANONICAL_HE_SHI_VENDOR;
export const HISTORICAL_MENU_IMPORTER_VERSION = 'legacy-sql-menu';
export const SQL_SOURCE_KIND = 'legacy_sql';
export const GAS_SOURCE_KIND = 'gas_compatibility';
export const ADMIN_SOURCE_KIND = 'admin';
export const AP_VARIANT_KEYS = Object.freeze(['ap-variant-1', 'ap-variant-2']);
const COMPATIBILITY_BASELINE_SOURCE_KIND = 'compatibility_baseline';

const rowsFrom = (result) => (
  Array.isArray(result) ? result : (Array.isArray(result?.results) ? result.results : [])
);

const text = (value) => (typeof value === 'string' ? value.trim() : '');

const identityKey = (vendor, itemCode, variantKey) => (
  `${vendor}\u0000${itemCode}\u0000${variantKey}`
);

const projectionHash = (value) => {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

export const projectionVersionId = (vendor, effectiveDate) => (
  `menu-change-projection_${projectionHash(`${vendor}|${effectiveDate}`)}`
);

export const projectionItemId = (vendor, effectiveDate, itemCode, variantKey = '') => (
  `menu-change-item_${projectionHash(`${vendor}|${effectiveDate}|${itemCode}|${variantKey}`)}`
);

const normalizedChange = (row) => {
  const vendor = canonicalMenuRowVendor({ vendor: row.vendor, itemCode: row.item_code });
  return {
  menu_item_change_id: row.menu_item_change_id,
  effective_date: row.effective_date,
  vendor,
  item_code: row.item_code,
  variant_key: row.variant_key || '',
  item_name: row.item_name,
  price: Number(row.price),
  enabled: Boolean(row.enabled),
  image_url: row.image_url || '',
  note: row.note || '',
  display_order: Number(row.display_order || 0),
  source_kind: row.source_kind,
  source_batch_id: row.source_batch_id || null,
  source_table: row.source_table || null,
  source_row: row.source_row ?? null,
  source_record_id: row.source_record_id || null,
  updated_by_user_id: row.updated_by_user_id || null,
  created_at: row.created_at,
  updated_at: row.updated_at,
  source_read_only: row.source_kind !== ADMIN_SOURCE_KIND,
  menu_item_id: projectionItemId(vendor, row.effective_date, row.item_code, row.variant_key || '')
  };
};

const sourceKindsFor = (vendor, targetDate) => {
  if (isHistoricalMenuVendor(vendor) && targetDate <= HISTORICAL_MENU_CUTOFF) {
    return {
      authority: 'sql_historical',
      sourceKinds: [SQL_SOURCE_KIND]
    };
  }
  return {
    authority: 'live_with_admin_overrides',
    sourceKinds: [GAS_SOURCE_KIND, ADMIN_SOURCE_KIND]
  };
};

const resolveRows = (rows, { vendor, targetDate }) => {
  const normalizedVendor = normalizeMenuVendor(vendor);
  const { authority, sourceKinds } = sourceKindsFor(normalizedVendor, targetDate);
  const selected = new Map();
  for (const rawRow of rows) {
    const row = normalizedChange(rawRow);
    if (row.vendor !== normalizedVendor || text(rawRow.effective_date) > targetDate) continue;
    if (!sourceKinds.includes(rawRow.source_kind)) continue;
    const key = identityKey(row.vendor, row.item_code, row.variant_key);
    const previous = selected.get(key);
    if (!previous
      || row.effective_date > previous.effective_date
      || (row.effective_date === previous.effective_date
        && row.menu_item_change_id > previous.menu_item_change_id)) {
      selected.set(key, row);
    }
  }
  return {
    authority,
    sourceKinds,
    rows: [...selected.values()].sort((left, right) => (
      left.display_order - right.display_order
      || left.item_code.localeCompare(right.item_code)
      || left.variant_key.localeCompare(right.variant_key)
      || left.menu_item_change_id.localeCompare(right.menu_item_change_id)
    ))
  };
};

const stateRows = (rows) => [...rows].sort((left, right) => (
  left.display_order - right.display_order
  || left.item_code.localeCompare(right.item_code)
  || left.variant_key.localeCompare(right.variant_key)
  || String(left.menu_item_change_id).localeCompare(String(right.menu_item_change_id))
));

const normalizeCompatibilityRow = (row, version) => ({
  menu_item_change_id: `compatibility:${row.menu_item_id}`,
  effective_date: version.effective_date,
  vendor: canonicalMenuRowVendor({ vendor: version.vendor, itemCode: row.legacy_item_id }),
  item_code: row.legacy_item_id,
  variant_key: row.variant_key || '',
  item_name: row.item_name,
  price: Number(row.price),
  enabled: Boolean(row.enabled),
  image_url: row.image_url || '',
  note: row.note || '',
  display_order: Number(row.source_order || 0),
  source_kind: COMPATIBILITY_BASELINE_SOURCE_KIND,
  source_batch_id: version.source_batch_id || null,
  source_table: null,
  source_row: null,
  source_record_id: row.menu_item_id,
  updated_by_user_id: null,
  created_at: row.created_at,
  updated_at: row.updated_at,
  source_read_only: true,
  menu_item_id: row.menu_item_id,
  persisted_menu_item_id: row.menu_item_id
});

const compatibilityVersion = async (database, vendor, targetDate) => {
  const normalizedVendor = normalizeMenuVendor(vendor);
  const vendors = compatibilityVendorCandidates(normalizedVendor);
  const placeholders = vendors.map(() => '?').join(', ');
  if (isHistoricalMenuVendor(normalizedVendor) && targetDate <= HISTORICAL_MENU_CUTOFF) {
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
  }
  return database.prepare(`
    SELECT menu_version_id, vendor, effective_date, source_batch_id
    FROM menu_versions
    WHERE vendor IN (${placeholders}) AND effective_date <= ?
    ORDER BY effective_date DESC, menu_version_id DESC
    LIMIT 1
  `).bind(...vendors, targetDate).first();
};

export const getCompatibilityMenuBaseline = async (database, { vendor, targetDate } = {}) => {
  const normalizedVendor = normalizeMenuVendor(vendor);
  const normalizedDate = text(targetDate);
  if (!normalizedVendor || !isDateOnly(normalizedDate)) {
    throw badRequest('MENU_CHANGE_RESOLUTION_INPUT_INVALID');
  }
  const version = await compatibilityVersion(database, normalizedVendor, normalizedDate);
  if (!version) return { version: null, rows: [] };
  const result = await database.prepare(`
    SELECT menu_item_id, legacy_item_id, variant_key, item_name, price,
           enabled, note, image_url, source_order, created_at, updated_at
    FROM menu_items
    WHERE menu_version_id = ?
    ORDER BY source_order ASC, menu_item_id ASC
  `).bind(version.menu_version_id).all();
  return {
    version,
    rows: rowsFrom(result).map((row) => normalizeCompatibilityRow(row, version))
  };
};

const attachCompatibilityIds = (rows, baselineRows) => rows.map((row) => {
  const matches = baselineRows.filter((baseline) => (
    baseline.item_code === row.item_code
      && baseline.variant_key === row.variant_key
  ));
  if (matches.length !== 1) return { ...row, persisted_menu_item_id: null };
  return {
    ...row,
    menu_item_id: matches[0].menu_item_id,
    persisted_menu_item_id: matches[0].menu_item_id
  };
});

export const mergeEffectiveMenuRows = ({ baselineRows = [], changeRows = [] } = {}) => {
  let merged = [...baselineRows];
  for (const change of changeRows) {
    const matchingIndexes = merged.reduce((indexes, row, index) => {
      if (row.item_code === change.item_code && row.variant_key === change.variant_key) {
        indexes.push(index);
      }
      return indexes;
    }, []);
    const persistedMenuItemId = matchingIndexes.length === 1
      ? merged[matchingIndexes[0]].menu_item_id
      : null;
    if (matchingIndexes.length) {
      merged = merged.filter((row) => (
        row.item_code !== change.item_code || row.variant_key !== change.variant_key
      ));
    }
    merged.push({
      ...change,
      menu_item_id: persistedMenuItemId || change.menu_item_id,
      persisted_menu_item_id: persistedMenuItemId
    });
  }
  return stateRows(merged);
};

export const resolveMenuItemChangesFromRows = (rows = [], options = {}) => {
  const vendor = normalizeMenuVendor(options.vendor);
  const targetDate = text(options.targetDate);
  if (!vendor || !isDateOnly(targetDate)) throw badRequest('MENU_CHANGE_RESOLUTION_INPUT_INVALID');
  return resolveRows(rows, { vendor, targetDate });
};

export const resolveMenuItemChanges = async (database, { vendor, targetDate } = {}) => {
  const normalizedVendor = normalizeMenuVendor(vendor);
  const normalizedDate = text(targetDate);
  if (!normalizedVendor || !isDateOnly(normalizedDate)) {
    throw badRequest('MENU_CHANGE_RESOLUTION_INPUT_INVALID');
  }
  const vendors = historicalMenuRowVendorCandidates(normalizedVendor);
  const placeholders = vendors.map(() => '?').join(', ');
  const result = await database.prepare(`
    SELECT menu_item_change_id, effective_date, vendor, item_code, variant_key,
           item_name, price, enabled, image_url, note, display_order,
           source_kind, source_batch_id, source_table, source_row,
           source_record_id, updated_by_user_id, created_at, updated_at
    FROM menu_item_changes
    WHERE vendor IN (${placeholders}) AND effective_date <= ?
    ORDER BY effective_date DESC, menu_item_change_id DESC
  `).bind(...vendors, normalizedDate).all();
  return resolveRows(rowsFrom(result), {
    vendor: normalizedVendor,
    targetDate: normalizedDate
  });
};

const getLatestCompatibilityImageRows = async (database) => {
  const result = await database.prepare(`
    SELECT mv.menu_version_id, mv.vendor AS version_vendor,
           mv.effective_date AS version_effective_date,
           mi.menu_item_id, mi.legacy_item_id, mi.variant_key, mi.item_name,
           mi.price, mi.enabled, mi.note, mi.image_url, mi.source_order,
           mi.created_at, mi.updated_at
    FROM menu_versions mv
    JOIN menu_items mi ON mi.menu_version_id = mv.menu_version_id
    WHERE mv.source_batch_id IS NULL
    ORDER BY mv.effective_date DESC, mv.menu_version_id DESC,
             mi.source_order ASC, mi.menu_item_id ASC
  `).all();
  const selectedVersionByVendor = new Map();
  const rows = [];
  for (const rawRow of rowsFrom(result)) {
    const canonicalVersionVendor = normalizeMenuVendor(rawRow.version_vendor);
    if (!selectedVersionByVendor.has(canonicalVersionVendor)) {
      selectedVersionByVendor.set(canonicalVersionVendor, rawRow.menu_version_id);
    }
    if (selectedVersionByVendor.get(canonicalVersionVendor) !== rawRow.menu_version_id) continue;
    rows.push(normalizeCompatibilityRow(rawRow, {
      vendor: rawRow.version_vendor,
      effective_date: rawRow.version_effective_date,
      source_batch_id: null
    }));
  }
  return rows;
};

const addToIndex = (index, key, row) => {
  const matches = index.get(key) || [];
  matches.push(row);
  index.set(key, matches);
};

const historicalDisplayImage = (row, currentRows) => {
  const normalizedName = normalizeMenuItemName(row.item_name);
  if (!normalizedName) return '';
  const byVendorAndName = new Map();
  const byName = new Map();
  for (const currentRow of currentRows) {
    const currentName = normalizeMenuItemName(currentRow.item_name);
    if (!currentName) continue;
    addToIndex(byVendorAndName, `${normalizeMenuVendor(currentRow.vendor)}\u0000${currentName}`, currentRow);
    addToIndex(byName, currentName, currentRow);
  }
  const scopedMatches = byVendorAndName.get(`${normalizeMenuVendor(row.vendor)}\u0000${normalizedName}`) || [];
  if (scopedMatches.length === 1) return scopedMatches[0].image_url || '';
  if (scopedMatches.length > 1) return '';
  const nameMatches = byName.get(normalizedName) || [];
  return nameMatches.length === 1 ? nameMatches[0].image_url || '' : '';
};

const applyHistoricalImageFallback = async (database, rows) => {
  const currentRows = await getLatestCompatibilityImageRows(database);
  return rows.map((row) => ({
    ...row,
    display_image_url: row.image_url || historicalDisplayImage(row, currentRows)
  }));
};

export const resolveEffectiveMenuState = async (database, { vendor, targetDate } = {}) => {
  const changes = await resolveMenuItemChanges(database, { vendor, targetDate });
  const baseline = await getCompatibilityMenuBaseline(database, { vendor, targetDate });
  const rows = changes.authority === 'sql_historical'
    ? attachCompatibilityIds(changes.rows, baseline.rows)
    : mergeEffectiveMenuRows({ baselineRows: baseline.rows, changeRows: changes.rows });
  const displayRows = changes.authority === 'sql_historical'
    ? await applyHistoricalImageFallback(database, rows)
    : rows;
  return {
    ...changes,
    baselineVersion: baseline.version,
    baselineRows: baseline.rows,
    changeRows: changes.rows,
    rows: displayRows
  };
};

const materializerRows = (rows) => rows.filter((row) => row.enabled).map((row, index) => ({
  ...row,
  source_order: row.display_order > 0 ? row.display_order : index + 1
}));

export const materializationPlan = ({ vendor, effectiveDate, resolved } = {}) => {
  const normalizedVendor = normalizeMenuVendor(vendor);
  const normalizedDate = text(effectiveDate);
  if (!normalizedVendor || !isDateOnly(normalizedDate)) {
    throw badRequest('MENU_CHANGE_MATERIALIZATION_INPUT_INVALID');
  }
  if (normalizedVendor === HISTORICAL_MENU_VENDOR && normalizedDate <= HISTORICAL_MENU_CUTOFF) {
    throw conflict('HISTORICAL_MENU_PROJECTION_IMMUTABLE');
  }
  const rows = Array.isArray(resolved) ? resolved : [];
  return {
    menuVersionId: projectionVersionId(normalizedVendor, normalizedDate),
    vendor: normalizedVendor,
    effectiveDate: normalizedDate,
    rows: materializerRows(rows)
  };
};

const materializationStatements = (database, plan, clock) => {
  const occurredAt = resolveClock(clock).toISOString();
  const statements = [
    prepareStatement(database, `
      INSERT INTO menu_versions (menu_version_id, vendor, effective_date, source_batch_id, created_at)
      VALUES (?, ?, ?, NULL, ?)
      ON CONFLICT(vendor, effective_date) DO NOTHING
    `, [plan.menuVersionId, plan.vendor, plan.effectiveDate, occurredAt]),
    prepareStatement(database, `
      UPDATE menu_items
      SET enabled = 0, updated_at = ?
      WHERE menu_version_id = ?
    `, [occurredAt, plan.menuVersionId])
  ];
  statements.push(...plan.rows.map((row) => prepareStatement(database, `
    INSERT INTO menu_items (
      menu_item_id, menu_version_id, legacy_item_id, variant_key, item_name,
      price, enabled, note, image_url, source_order, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)
    ON CONFLICT(menu_item_id) DO UPDATE SET
      menu_version_id = excluded.menu_version_id,
      legacy_item_id = excluded.legacy_item_id,
      variant_key = excluded.variant_key,
      item_name = excluded.item_name,
      price = excluded.price,
      enabled = excluded.enabled,
      note = excluded.note,
      image_url = excluded.image_url,
      source_order = excluded.source_order,
      updated_at = excluded.updated_at
  `, [
    projectionItemId(plan.vendor, plan.effectiveDate, row.item_code, row.variant_key),
    plan.menuVersionId,
    row.item_code,
    row.variant_key,
    row.item_name,
    row.price,
    row.note,
    row.image_url,
    row.source_order,
    occurredAt,
    occurredAt
  ])));
  return statements;
};

export const prepareMenuVersionMaterialization = async (
  database,
  { vendor, effectiveDate, clock = new Date(), resolved = null, authority = null } = {}
) => {
  const resolution = resolved
    ? { rows: resolved, authority }
    : await resolveEffectiveMenuState(database, { vendor, targetDate: effectiveDate });
  const plan = materializationPlan({
    vendor,
    effectiveDate,
    resolved: resolution.rows
  });
  const existing = await database.prepare(`
    SELECT menu_version_id, source_batch_id
    FROM menu_versions
    WHERE vendor = ? AND effective_date = ?
    LIMIT 1
  `).bind(plan.vendor, plan.effectiveDate).first();
  if (existing && existing.menu_version_id !== plan.menuVersionId) {
    if (existing.source_batch_id) throw conflict('MENU_VERSION_IMMUTABLE');
    plan.menuVersionId = existing.menu_version_id;
  }
  if (!plan.rows.length) throw notFound('MENU_CHANGE_PROJECTION_EMPTY');
  return {
    statements: materializationStatements(database, plan, clock),
    result: {
      success: true,
      authority: resolution.authority || 'live_with_admin_overrides',
      menuVersionId: plan.menuVersionId,
      effectiveDate: plan.effectiveDate,
      projectedItemCount: plan.rows.length,
      resolvedItemCount: resolution.rows.length
    }
  };
};

export const materializeMenuVersion = async (
  database,
  options = {}
) => {
  const prepared = await prepareMenuVersionMaterialization(database, options);
  await runMutationBatch(database, prepared.statements);
  return prepared.result;
};

const validExternalUrl = (value) => {
  const normalized = value === undefined || value === null ? '' : text(value);
  if (!normalized) return '';
  let parsed;
  try {
    parsed = new URL(normalized);
  } catch {
    throw badRequest('MENU_CHANGE_IMAGE_URL_INVALID');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw badRequest('MENU_CHANGE_IMAGE_URL_INVALID');
  }
  return normalized;
};

const requiredText = (value, code, maxLength = 200) => {
  const normalized = text(value);
  if (!normalized) throw badRequest(code);
  if (normalized.length > maxLength) throw badRequest(`${code}_TOO_LONG`);
  return normalized;
};

const optionalText = (value, code, maxLength = 2000) => {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw badRequest(code);
  const normalized = value.trim();
  if (normalized.length > maxLength) throw badRequest(`${code}_TOO_LONG`);
  return normalized;
};

const knownVariantKeysFor = (vendor, itemCode) => (
  vendor === HISTORICAL_MENU_VENDOR && itemCode.toUpperCase() === 'AP'
    ? AP_VARIANT_KEYS
    : []
);

const assertVariantIdentity = async (database, values) => {
  const knownVariantKeys = knownVariantKeysFor(values.vendor, values.item_code);
  if (knownVariantKeys.length && !values.variant_key) {
    throw badRequest('MENU_CHANGE_VARIANT_KEY_REQUIRED');
  }
  if (knownVariantKeys.length && !knownVariantKeys.includes(values.variant_key)) {
    throw badRequest('MENU_CHANGE_VARIANT_KEY_INVALID');
  }
  const result = await database.prepare(`
    SELECT variant_key
    FROM menu_item_changes
    WHERE vendor = ? AND item_code = ? AND effective_date = ?
  `).bind(values.vendor, values.item_code, values.effective_date).all();
  const existing = rowsFrom(result);
  if (!values.variant_key && existing.some((row) => text(row.variant_key))) {
    throw badRequest('MENU_CHANGE_VARIANT_KEY_REQUIRED');
  }
  if (values.variant_key && existing.some((row) => !text(row.variant_key))) {
    throw badRequest('MENU_CHANGE_VARIANT_KEY_REQUIRED');
  }
};

const createInput = (input) => {
  const allowed = new Set([
    'effective_date', 'effectiveDate', 'vendor', 'item_code', 'itemCode',
    'variant_key', 'variantKey', 'item_name', 'itemName', 'price', 'enabled',
    'image_url', 'imageUrl', 'note', 'display_order', 'displayOrder'
  ]);
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some((field) => !allowed.has(field))) {
    throw badRequest('MENU_CHANGE_UNKNOWN_FIELD');
  }
  const effectiveDate = text(input.effective_date ?? input.effectiveDate);
  if (!isDateOnly(effectiveDate)) throw badRequest('MENU_CHANGE_EFFECTIVE_DATE_INVALID');
  if (effectiveDate <= HISTORICAL_MENU_CUTOFF) {
    throw badRequest('MENU_CHANGE_EFFECTIVE_DATE_BEFORE_CUTOFF');
  }
  const rawPrice = input.price;
  if (rawPrice === undefined || rawPrice === null
    || (typeof rawPrice === 'string' && !rawPrice.trim())) {
    throw badRequest('MENU_CHANGE_PRICE_INVALID');
  }
  const price = typeof rawPrice === 'number'
    ? rawPrice
    : (typeof rawPrice === 'string' ? Number(rawPrice.trim()) : NaN);
  if (!Number.isSafeInteger(price)) throw badRequest('MENU_CHANGE_PRICE_INVALID');
  if (input.enabled !== undefined && typeof input.enabled !== 'boolean') {
    throw badRequest('MENU_CHANGE_ENABLED_INVALID');
  }
  const displayOrderValue = input.display_order ?? input.displayOrder ?? 0;
  const displayOrder = Number(displayOrderValue);
  if (!Number.isSafeInteger(displayOrder) || displayOrder < 0) {
    throw badRequest('MENU_CHANGE_DISPLAY_ORDER_INVALID');
  }
  const vendor = requiredText(input.vendor, 'MENU_CHANGE_VENDOR_REQUIRED');
  const itemCode = requiredText(input.item_code ?? input.itemCode, 'MENU_CHANGE_ITEM_CODE_REQUIRED');
  return {
    effective_date: effectiveDate,
    vendor: canonicalMenuRowVendor({ vendor, itemCode }),
    item_code: itemCode,
    variant_key: optionalText(input.variant_key ?? input.variantKey, 'MENU_CHANGE_VARIANT_KEY_INVALID', 200),
    item_name: requiredText(input.item_name ?? input.itemName, 'MENU_CHANGE_ITEM_NAME_REQUIRED'),
    price,
    enabled: input.enabled !== false,
    image_url: validExternalUrl(input.image_url ?? input.imageUrl),
    note: optionalText(input.note, 'MENU_CHANGE_NOTE_INVALID'),
    display_order: displayOrder
  };
};

const changeSelect = `
  SELECT menu_item_change_id, effective_date, vendor, item_code, variant_key,
         item_name, price, enabled, image_url, note, display_order,
         source_kind, source_batch_id, source_table, source_row,
         source_record_id, updated_by_user_id, created_at, updated_at
  FROM menu_item_changes
`;

const filtersFor = ({ vendor = '', fromDate = '', toDate = '', month = '', itemCode = '', query = '', variantKey = '' } = {}) => {
  const conditions = [];
  const bindings = [];
  const addLike = (column, value) => {
    const normalized = text(value);
    if (normalized) {
      conditions.push(`${column} LIKE ? COLLATE NOCASE`);
      bindings.push(`%${normalized}%`);
    }
  };
  addLike('vendor', vendor);
  addLike('item_code', itemCode);
  addLike('variant_key', variantKey);
  const q = text(query);
  if (q) {
    conditions.push('(item_code LIKE ? COLLATE NOCASE OR item_name LIKE ? COLLATE NOCASE)');
    bindings.push(`%${q}%`, `%${q}%`);
  }
  if (isDateOnly(text(fromDate))) {
    conditions.push('effective_date >= ?');
    bindings.push(text(fromDate));
  }
  if (isDateOnly(text(toDate))) {
    conditions.push('effective_date <= ?');
    bindings.push(text(toDate));
  }
  if (/^\d{4}-\d{2}$/.test(text(month))) {
    conditions.push('substr(effective_date, 1, 7) = ?');
    bindings.push(text(month));
  }
  return {
    suffix: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '',
    bindings
  };
};

export const listAdminMenuItemChanges = async (database, identity, filters = {}) => {
  assertCan(identity, ACTIONS.ADMIN_MENU_CHANGES);
  if (identity?.viewAs || (
    identity?.effectiveSubject?.userId
      && identity.effectiveSubject.userId !== identity?.actor?.userId
  )) throw forbidden('VIEW_AS_FORBIDDEN');
  const filter = filtersFor(filters);
  const result = await database.prepare(`
    ${changeSelect}
    ${filter.suffix}
    ORDER BY effective_date DESC, vendor ASC, item_code ASC, variant_key ASC,
             display_order ASC, menu_item_change_id ASC
  `).bind(...filter.bindings).all();
  return {
    success: true,
    changes: rowsFrom(result).map(normalizedChange)
  };
};

const uniqueChangeError = (error) => /UNIQUE constraint failed:\s*menu_item_changes\./i.test(
  String(error?.cause?.message || error?.message || '')
);

export const createAdminMenuItemChange = async (
  database,
  identity,
  input,
  clock = new Date()
) => {
  assertCan(identity, ACTIONS.ADMIN_MENU_CHANGES);
  if (identity?.viewAs || (
    identity?.effectiveSubject?.userId
      && identity.effectiveSubject.userId !== identity?.actor?.userId
  )) {
    throw forbidden('VIEW_AS_MUTATION_FORBIDDEN');
  }
  const values = createInput(input);
  await assertVariantIdentity(database, values);
  const changeId = randomId('menu-change');
  const occurredAt = resolveClock(clock).toISOString();
  const insert = prepareStatement(database, `
    INSERT INTO menu_item_changes (
      menu_item_change_id, effective_date, vendor, item_code, variant_key,
      item_name, price, enabled, image_url, note, display_order,
      source_kind, source_table, source_record_id, updated_by_user_id,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'admin', 'admin_menu_item_changes', ?, ?, ?, ?)
  `, [
    changeId, values.effective_date, values.vendor, values.item_code, values.variant_key,
    values.item_name, values.price, values.enabled ? 1 : 0, values.image_url, values.note,
    values.display_order, changeId, identity.actor.userId, occurredAt, occurredAt
  ]);
  const audit = auditStatement(database, {
    actorUserId: identity.actor.userId,
    actorAuthMode: identity.actor.authMode,
    actorEmployeeIdSnapshot: identity.actor.employeeId,
    actorLineUserIdSnapshot: identity.actor.lineUserId,
    action: 'MENU_ITEM_CHANGE_CREATED',
    metadata: {
      menuItemChangeId: changeId,
      vendor: values.vendor,
      itemCode: values.item_code,
      variantKey: values.variant_key,
      effectiveDate: values.effective_date
    },
    occurredAt
  });
  const proposedChange = {
    menu_item_change_id: changeId,
    effective_date: values.effective_date,
    vendor: values.vendor,
    item_code: values.item_code,
    variant_key: values.variant_key,
    item_name: values.item_name,
    price: values.price,
    enabled: values.enabled,
    image_url: values.image_url,
    note: values.note,
    display_order: values.display_order,
    source_kind: ADMIN_SOURCE_KIND,
    source_batch_id: null,
    source_table: 'admin_menu_item_changes',
    source_record_id: changeId,
    updated_by_user_id: identity.actor.userId,
    created_at: occurredAt,
    updated_at: occurredAt
  };
  const currentResolution = await resolveEffectiveMenuState(database, {
    vendor: values.vendor,
    targetDate: values.effective_date
  });
  const prospectiveRows = mergeEffectiveMenuRows({
    baselineRows: currentResolution.baselineRows,
    changeRows: [...currentResolution.changeRows, proposedChange]
  });
  const projection = await prepareMenuVersionMaterialization(database, {
    vendor: values.vendor,
    effectiveDate: values.effective_date,
    clock,
    resolved: prospectiveRows,
    authority: currentResolution.authority
  });
  try {
    await runMutationBatch(database, [insert, audit, ...projection.statements]);
  } catch (error) {
    if (uniqueChangeError(error)) throw conflict('MENU_CHANGE_DUPLICATE');
    throw error;
  }

  const row = await database.prepare(`${changeSelect} WHERE menu_item_change_id = ?`)
    .bind(changeId).first();
  return { success: true, change: normalizedChange(row) };
};

export const getAdminMenuItemPreview = async (
  database,
  identity,
  { vendor, targetDate } = {}
) => {
  assertCan(identity, ACTIONS.ADMIN_MENU_CHANGES);
  if (identity?.viewAs || (
    identity?.effectiveSubject?.userId
      && identity.effectiveSubject.userId !== identity?.actor?.userId
  )) throw forbidden('VIEW_AS_FORBIDDEN');
  const resolution = await resolveEffectiveMenuState(database, { vendor, targetDate });
  return {
    success: true,
    authority: resolution.authority,
    targetDate,
    vendor,
    items: resolution.rows,
    selectableItems: resolution.rows.filter((row) => row.enabled)
  };
};

export const menuChangeIdentityKey = identityKey;

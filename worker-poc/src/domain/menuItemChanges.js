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
  CANONICAL_MENU_VENDORS,
  HISTORICAL_SQL_VENDOR,
  canonicalMenuRowVendor,
  compatibilityVendorCandidates,
  historicalMenuRowVendorCandidates,
  isHistoricalMenuVendor,
  normalizeMenuVendor
} from './menuVendors.js';
import {
  buildHistoricalImageFallbackIndex,
  resolveHistoricalImageDisplayUrl
} from './menuImageFallback.js';

export const HISTORICAL_MENU_CUTOFF = '2026-09-10';
export const NORMALIZED_MENU_START_DATE = '2026-09-17';
export const LEGACY_IDENTITY_SCHEMA_VERSION = 1;
export const NORMALIZED_IDENTITY_SCHEMA_VERSION = 2;
export const NORMALIZED_VARIANT_KEYS = Object.freeze(['BASE', 'HALF', 'PLUS']);
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

const normalizedIdentity = (itemCode, variantKey) => ({
  item_code: itemCode,
  variant_key: variantKey
});

/**
 * Project a legacy menu code into the normalized identity only for a future
 * normalized menu projection. The stored historical row is never rewritten.
 * AP intentionally requires the historical item name because its raw code is
 * shared by A/PLUS and AM/BASE.
 */
export const normalizeLegacyMenuIdentity = ({ vendor, itemCode, variantKey = '', itemName = '' } = {}) => {
  const normalizedVendor = normalizeMenuVendor(vendor);
  const code = text(itemCode);
  const codeKey = code.toUpperCase();
  const variant = text(variantKey).toUpperCase();
  const name = text(itemName);
  if (!code) return null;

  const direct = new Map([
    ['S', normalizedIdentity('S', 'BASE')],
    ['SH', normalizedIdentity('S', 'HALF')],
    ['S_HALF', normalizedIdentity('S', 'HALF')],
    ['C', normalizedIdentity('C', 'BASE')],
    ['CH', normalizedIdentity('C', 'HALF')],
    ['C95', normalizedIdentity('C', 'BASE')],
    ['C95_HALF', normalizedIdentity('C', 'HALF')],
    ['CP', normalizedIdentity('CM', 'BASE')],
    ['CPH', normalizedIdentity('CM', 'HALF')],
    ['C120', normalizedIdentity('CM', 'BASE')],
    ['C120_HALF', normalizedIdentity('CM', 'HALF')],
    ['E', normalizedIdentity('E', 'BASE')],
    ['EP', normalizedIdentity('E', 'PLUS')],
    ['E_PLUS', normalizedIdentity('E', 'PLUS')],
    ['A', normalizedIdentity('A', 'BASE')],
    ['A95', normalizedIdentity('A', 'BASE')],
    ['A95_PLUS', normalizedIdentity('A', 'PLUS')],
    ['A120', normalizedIdentity('AM', 'BASE')],
    ['A120_PLUS', normalizedIdentity('AM', 'PLUS')],
    ['APP', normalizedIdentity('AM', 'PLUS')],
    ['B', normalizedIdentity('B', 'BASE')],
    ['B_HALF', normalizedIdentity('B', 'HALF')],
    ['FR', normalizedIdentity('FR', 'BASE')],
    ['R', normalizedIdentity('FR', 'BASE')]
  ]);
  if (direct.has(codeKey)) return direct.get(codeKey);

  if (codeKey === 'AP') {
    if (name.includes('風味便當')) return normalizedIdentity('A', 'PLUS');
    if (name.includes('風味會議')) return normalizedIdentity('AM', 'BASE');
    return null;
  }

  const halfMatch = codeKey.match(/^(H[1-5])H$/);
  if (halfMatch) return normalizedIdentity(halfMatch[1], 'HALF');
  if (/^H[1-5]$/.test(codeKey)) return normalizedIdentity(codeKey, 'BASE');

  if (NORMALIZED_VARIANT_KEYS.includes(variant)) {
    return normalizedIdentity(code, variant);
  }
  if (normalizedVendor === HE_SHI_MENU_VENDOR && /^H[1-5]$/.test(codeKey)) {
    return normalizedIdentity(codeKey, 'BASE');
  }
  return null;
};

const legacyCodeCannotBeUsedForNormalizedIdentity = (itemCode) => new Set([
  'AP', 'APP', 'SH', 'EP', 'E_PLUS', 'S_HALF', 'C95', 'C95_HALF',
  'C120', 'C120_HALF', 'CP', 'CPH', 'A95', 'A95_PLUS', 'A120',
  'A120_PLUS', 'B_HALF', 'FR1', 'REVERT1', 'R', 'S_HALF',
  'H1H', 'H2H', 'H3H', 'H4H', 'H5H'
]).has(String(itemCode || '').trim().toUpperCase());

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
  identity_schema_version: Number(row.identity_schema_version || LEGACY_IDENTITY_SCHEMA_VERSION),
  sequence_number: row.sequence_number === undefined || row.sequence_number === null
    ? null : Number(row.sequence_number),
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
    if (row.identity_schema_version !== LEGACY_IDENTITY_SCHEMA_VERSION) continue;
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

const resolveNormalizedRows = (rows, { vendor, targetDate }) => {
  const normalizedVendor = normalizeMenuVendor(vendor);
  const selected = new Map();
  for (const rawRow of rows) {
    const row = normalizedChange(rawRow);
    if (row.identity_schema_version !== NORMALIZED_IDENTITY_SCHEMA_VERSION) continue;
    if (row.vendor !== normalizedVendor || text(row.effective_date) > targetDate) continue;
    if (row.source_kind !== ADMIN_SOURCE_KIND) continue;
    const key = identityKey(row.vendor, row.item_code, row.variant_key);
    const previous = selected.get(key);
    if (!previous
      || row.effective_date > previous.effective_date
      || (row.effective_date === previous.effective_date
        && Number(row.sequence_number || 0) > Number(previous.sequence_number || 0))) {
      selected.set(key, row);
    }
  }
  return [...selected.values()].sort((left, right) => (
    left.display_order - right.display_order
    || left.item_code.localeCompare(right.item_code)
    || left.variant_key.localeCompare(right.variant_key)
    || Number(left.sequence_number || 0) - Number(right.sequence_number || 0)
  ));
};

const normalizedProjectionRow = (row) => {
  const identity = normalizeLegacyMenuIdentity({
    vendor: row.vendor,
    itemCode: row.item_code || row.legacy_item_id,
    variantKey: row.variant_key,
    itemName: row.item_name
  });
  if (!identity) return normalizedChange(row);
  return normalizedChange({
    ...row,
    ...identity,
    identity_schema_version: NORMALIZED_IDENTITY_SCHEMA_VERSION
  });
};

const normalizedProjectionRows = (rows) => rows.map(normalizedProjectionRow);

const collapseNormalizedProjectionRows = (rows) => {
  const selected = new Map();
  const passthrough = [];
  for (const row of rows) {
    if (row.identity_schema_version !== NORMALIZED_IDENTITY_SCHEMA_VERSION) {
      passthrough.push(row);
      continue;
    }
    const key = identityKey(row.vendor, row.item_code, row.variant_key);
    const previous = selected.get(key);
    if (!previous
      || row.effective_date > previous.effective_date
      || (row.effective_date === previous.effective_date
        && Number(row.sequence_number || 0) > Number(previous.sequence_number || 0))) {
      selected.set(key, row);
    }
  }
  return [...passthrough, ...selected.values()];
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
  const legacy = resolveRows(rows, { vendor, targetDate });
  const normalized = resolveNormalizedRows(rows, { vendor, targetDate });
  return {
    ...legacy,
    rows: targetDate >= NORMALIZED_MENU_START_DATE && normalized.length
      ? normalized
      : legacy.rows,
    legacyRows: legacy.rows,
    normalizedRows: normalized
  };
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
    SELECT mic.menu_item_change_id, mic.effective_date, mic.vendor, mic.item_code, mic.variant_key,
           item_name, price, enabled, image_url, note, display_order,
           source_kind, source_batch_id, source_table, source_row,
           source_record_id, updated_by_user_id, created_at, updated_at,
           mic.identity_schema_version, mis.sequence_number
    FROM menu_item_changes mic
    LEFT JOIN menu_item_change_sequence mis
      ON mis.menu_item_change_id = mic.menu_item_change_id
    WHERE mic.vendor IN (${placeholders}) AND mic.effective_date <= ?
    ORDER BY mic.effective_date DESC, mis.sequence_number DESC, mic.menu_item_change_id DESC
  `).bind(...vendors, normalizedDate).all();
  const legacy = resolveRows(rowsFrom(result), {
    vendor: normalizedVendor,
    targetDate: normalizedDate
  });
  const normalized = resolveNormalizedRows(rowsFrom(result), {
    vendor: normalizedVendor,
    targetDate: normalizedDate
  });
  return {
    ...legacy,
    rows: legacy.rows,
    legacyRows: legacy.rows,
    normalizedRows: normalized
  };
};

const getLatestCurrentMenuImageRows = async (database) => {
  const result = await database.prepare(`
    SELECT mv.menu_version_id, mv.vendor AS version_vendor,
           mv.effective_date AS version_effective_date,
           mv.source_batch_id AS version_source_batch_id,
           mi.menu_item_id, mi.legacy_item_id, mi.variant_key, mi.item_name,
           mi.price, mi.enabled, mi.note, mi.image_url, mi.source_order,
           mi.created_at, mi.updated_at
    FROM menu_versions mv
    JOIN menu_items mi ON mi.menu_version_id = mv.menu_version_id
    LEFT JOIN import_batches ib ON ib.batch_id = mv.source_batch_id
    WHERE ib.importer_version IS NULL OR ib.importer_version <> ?
    ORDER BY mv.effective_date DESC, mv.menu_version_id DESC,
             mi.source_order ASC, mi.menu_item_id ASC
  `).bind(HISTORICAL_MENU_IMPORTER_VERSION).all();
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
      source_batch_id: rawRow.version_source_batch_id || null
    }));
  }
  return rows;
};

const projectDisplayImageRows = async (database, rows) => {
  const currentRows = await getLatestCurrentMenuImageRows(database);
  const currentImageIndex = buildHistoricalImageFallbackIndex(currentRows);
  return rows.map((row) => ({
    ...row,
    display_image_url: resolveHistoricalImageDisplayUrl(row, currentImageIndex)
  }));
};

const applyHistoricalImageFallback = (database, rows) => projectDisplayImageRows(database, rows);

export const resolveEffectiveMenuState = async (database, { vendor, targetDate } = {}) => {
  const changes = await resolveMenuItemChanges(database, { vendor, targetDate });
  const baseline = await getCompatibilityMenuBaseline(database, { vendor, targetDate });
  const useNormalizedIdentity = changes.authority !== 'sql_historical'
    && text(targetDate) >= NORMALIZED_MENU_START_DATE;
  const effectiveBaselineRows = useNormalizedIdentity
    ? collapseNormalizedProjectionRows(normalizedProjectionRows(baseline.rows))
    : baseline.rows;
  const effectiveChangeRows = useNormalizedIdentity
    ? [
      ...collapseNormalizedProjectionRows(normalizedProjectionRows(changes.legacyRows || changes.rows)),
      ...(changes.normalizedRows || [])
    ]
    : changes.rows;
  const rows = changes.authority === 'sql_historical'
    ? attachCompatibilityIds(changes.rows, baseline.rows)
    : mergeEffectiveMenuRows({
      baselineRows: effectiveBaselineRows,
      changeRows: effectiveChangeRows
    });
  const displayRows = changes.authority === 'sql_historical'
    ? await applyHistoricalImageFallback(database, rows)
    : rows;
  return {
    ...changes,
    baselineVersion: baseline.version,
    baselineRows: effectiveBaselineRows,
    rawBaselineRows: baseline.rows,
    changeRows: effectiveChangeRows,
    legacyChangeRows: changes.legacyRows || changes.rows,
    normalizedChangeRows: changes.normalizedRows || [],
    normalizedIdentity: useNormalizedIdentity,
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
  if (values.identity_schema_version === NORMALIZED_IDENTITY_SCHEMA_VERSION) {
    if (!values.variant_key) {
      throw badRequest('MENU_CHANGE_VARIANT_KEY_INVALID');
    }
    if (legacyCodeCannotBeUsedForNormalizedIdentity(values.item_code)) {
      throw badRequest('MENU_CHANGE_NORMALIZED_ITEM_CODE_INVALID');
    }
    return;
  }
  const knownVariantKeys = knownVariantKeysFor(values.vendor, values.item_code);
  if (knownVariantKeys.length && !values.variant_key) {
    throw badRequest('MENU_CHANGE_VARIANT_KEY_REQUIRED');
  }
  if (knownVariantKeys.length && !knownVariantKeys.includes(values.variant_key)) {
    throw badRequest('MENU_CHANGE_VARIANT_KEY_INVALID');
  }
  const result = await database.prepare(`
    SELECT variant_key, identity_schema_version
    FROM menu_item_changes
    WHERE vendor = ? AND item_code = ? AND effective_date = ?
      AND identity_schema_version = ?
  `).bind(
    values.vendor,
    values.item_code,
    values.effective_date,
    values.identity_schema_version
  ).all();
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
    'image_url', 'imageUrl', 'note', 'display_order', 'displayOrder',
    'identity_schema_version', 'identitySchemaVersion',
    'previous_variant_key', 'previousVariantKey',
    'previous_identity_schema_version', 'previousIdentitySchemaVersion'
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
  const rawIdentityVersion = input.identity_schema_version ?? input.identitySchemaVersion;
  const identitySchemaVersion = rawIdentityVersion === undefined
    ? LEGACY_IDENTITY_SCHEMA_VERSION
    : Number(rawIdentityVersion);
  if (![LEGACY_IDENTITY_SCHEMA_VERSION, NORMALIZED_IDENTITY_SCHEMA_VERSION].includes(identitySchemaVersion)) {
    throw badRequest('MENU_CHANGE_IDENTITY_SCHEMA_VERSION_INVALID');
  }
  if (identitySchemaVersion === NORMALIZED_IDENTITY_SCHEMA_VERSION
    && effectiveDate < NORMALIZED_MENU_START_DATE) {
    throw badRequest('MENU_CHANGE_NORMALIZED_EFFECTIVE_DATE_INVALID');
  }
  let variantKey = optionalText(input.variant_key ?? input.variantKey, 'MENU_CHANGE_VARIANT_KEY_INVALID', 200);
  if (identitySchemaVersion === NORMALIZED_IDENTITY_SCHEMA_VERSION) {
    variantKey = variantKey.toUpperCase();
  }
  return {
    effective_date: effectiveDate,
    vendor: canonicalMenuRowVendor({ vendor, itemCode }),
    item_code: itemCode,
    variant_key: variantKey,
    item_name: requiredText(input.item_name ?? input.itemName, 'MENU_CHANGE_ITEM_NAME_REQUIRED'),
    price,
    enabled: input.enabled !== false,
    image_url: validExternalUrl(input.image_url ?? input.imageUrl),
    note: optionalText(input.note, 'MENU_CHANGE_NOTE_INVALID'),
    display_order: displayOrder,
    identity_schema_version: identitySchemaVersion,
    previous_variant_key: optionalText(
      input.previous_variant_key ?? input.previousVariantKey,
      'MENU_CHANGE_PREVIOUS_VARIANT_KEY_INVALID',
      200
    ),
    previous_identity_schema_version: input.previous_identity_schema_version
      ?? input.previousIdentitySchemaVersion
      ?? null
  };
};

const changeSelect = `
  SELECT mic.menu_item_change_id, mic.effective_date, mic.vendor, mic.item_code, mic.variant_key,
         item_name, price, enabled, image_url, note, display_order,
         source_kind, source_batch_id, source_table, source_row,
         source_record_id, updated_by_user_id, created_at, updated_at,
         mic.identity_schema_version, mis.sequence_number
  FROM menu_item_changes mic
  LEFT JOIN menu_item_change_sequence mis
    ON mis.menu_item_change_id = mic.menu_item_change_id
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
    ORDER BY mic.effective_date DESC, mic.vendor ASC, mic.item_code ASC, mic.variant_key ASC,
             mic.display_order ASC, mic.menu_item_change_id ASC
  `).bind(...filter.bindings).all();
  const projectedRows = await projectDisplayImageRows(
    database,
    rowsFrom(result).map(normalizedChange)
  );
  return {
    success: true,
    changes: projectedRows.map((row) => ({
      ...row,
      image_url: row.display_image_url || row.image_url
    }))
  };
};

export const listAdminMenuVendors = async (database, identity) => {
  assertCan(identity, ACTIONS.ADMIN_MENU_CHANGES);
  if (identity?.viewAs || (
    identity?.effectiveSubject?.userId
      && identity.effectiveSubject.userId !== identity?.actor?.userId
  )) throw forbidden('VIEW_AS_FORBIDDEN');
  return {
    success: true,
    vendors: [...CANONICAL_MENU_VENDORS]
  };
};

const uniqueChangeError = (error) => /UNIQUE constraint failed:\s*(menu_item_changes\.|idx_menu_item_changes_legacy_identity_unique)/i.test(
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
  const isVariantMove = values.identity_schema_version === NORMALIZED_IDENTITY_SCHEMA_VERSION
    && values.previous_variant_key
    && values.previous_variant_key !== values.variant_key;
  if (isVariantMove) {
    const previousVersion = values.previous_identity_schema_version === null
      ? NORMALIZED_IDENTITY_SCHEMA_VERSION
      : Number(values.previous_identity_schema_version);
    if (previousVersion !== NORMALIZED_IDENTITY_SCHEMA_VERSION) {
      throw badRequest('MENU_VARIANT_MOVE_NORMALIZED_ONLY');
    }
    const existing = await database.prepare(`
      SELECT menu_item_change_id
      FROM menu_item_changes
      WHERE vendor = ? AND item_code = ? AND variant_key = ?
        AND effective_date = ? AND identity_schema_version = ?
      LIMIT 1
    `).bind(
      values.vendor,
      values.item_code,
      values.variant_key,
      values.effective_date,
      NORMALIZED_IDENTITY_SCHEMA_VERSION
    ).first();
    if (existing) throw conflict('MENU_VARIANT_IDENTITY_CONFLICT');
  }
  const changeId = randomId('menu-change');
  const oldChangeId = isVariantMove ? randomId('menu-change-old') : null;
  const occurredAt = resolveClock(clock).toISOString();
  const insertStatement = (id, variantKey, enabled) => prepareStatement(database, `
    INSERT INTO menu_item_changes (
      menu_item_change_id, effective_date, vendor, item_code, variant_key,
      item_name, price, enabled, image_url, note, display_order,
      source_kind, source_table, source_record_id, updated_by_user_id,
      created_at, updated_at, identity_schema_version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'admin', 'admin_menu_item_changes', ?, ?, ?, ?, ?)
  `, [
    id, values.effective_date, values.vendor, values.item_code, variantKey,
    values.item_name, values.price, enabled ? 1 : 0, values.image_url, values.note,
    values.display_order, id, identity.actor.userId, occurredAt, occurredAt,
    values.identity_schema_version
  ]);
  const inserts = [];
  if (isVariantMove) inserts.push(insertStatement(
    oldChangeId, values.previous_variant_key, false
  ));
  inserts.push(insertStatement(changeId, values.variant_key, values.enabled));
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
      effectiveDate: values.effective_date,
      identitySchemaVersion: values.identity_schema_version,
      previousVariantKey: isVariantMove ? values.previous_variant_key : null,
      previousChangeId: oldChangeId
    },
    occurredAt
  });
  const proposedChange = (id, variantKey, enabled) => ({
    menu_item_change_id: id,
    effective_date: values.effective_date,
    vendor: values.vendor,
    item_code: values.item_code,
    variant_key: variantKey,
    item_name: values.item_name,
    price: values.price,
    enabled,
    image_url: values.image_url,
    note: values.note,
    display_order: values.display_order,
    source_kind: ADMIN_SOURCE_KIND,
    source_batch_id: null,
    source_table: 'admin_menu_item_changes',
    source_record_id: id,
    updated_by_user_id: identity.actor.userId,
    created_at: occurredAt,
    updated_at: occurredAt,
    identity_schema_version: values.identity_schema_version,
    sequence_number: null
  });
  const proposedChanges = [];
  if (isVariantMove) proposedChanges.push(proposedChange(
    oldChangeId, values.previous_variant_key, false
  ));
  proposedChanges.push(proposedChange(changeId, values.variant_key, values.enabled));
  const currentResolution = await resolveEffectiveMenuState(database, {
    vendor: values.vendor,
    targetDate: values.effective_date
  });
  const prospectiveRows = mergeEffectiveMenuRows({
    baselineRows: currentResolution.baselineRows,
    changeRows: [...currentResolution.changeRows, ...proposedChanges]
  });
  const projection = await prepareMenuVersionMaterialization(database, {
    vendor: values.vendor,
    effectiveDate: values.effective_date,
    clock,
    resolved: prospectiveRows,
    authority: currentResolution.authority
  });
  try {
    await runMutationBatch(database, [...inserts, audit, ...projection.statements]);
  } catch (error) {
    if (uniqueChangeError(error)) throw conflict('MENU_CHANGE_DUPLICATE');
    throw error;
  }

  const row = await database.prepare(`${changeSelect} WHERE mic.menu_item_change_id = ?`)
    .bind(changeId).first();
  return {
    success: true,
    change: normalizedChange(row),
    variant_move: isVariantMove ? {
      previous_change_id: oldChangeId,
      previous_variant_key: values.previous_variant_key,
      variant_key: values.variant_key
    } : null
  };
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

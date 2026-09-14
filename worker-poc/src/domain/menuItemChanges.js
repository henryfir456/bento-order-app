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

export const HISTORICAL_MENU_CUTOFF = '2026-09-10';
export const HISTORICAL_MENU_VENDOR = '蔡老師';
export const HISTORICAL_MENU_IMPORTER_VERSION = 'legacy-sql-menu';
export const SQL_SOURCE_KIND = 'legacy_sql';
export const GAS_SOURCE_KIND = 'gas_compatibility';
export const ADMIN_SOURCE_KIND = 'admin';

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

const normalizedChange = (row) => ({
  menu_item_change_id: row.menu_item_change_id,
  effective_date: row.effective_date,
  vendor: row.vendor,
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
  menu_item_id: projectionItemId(row.vendor, row.effective_date, row.item_code, row.variant_key || '')
});

const sourceKindsFor = (vendor, targetDate) => {
  if (vendor === HISTORICAL_MENU_VENDOR && targetDate <= HISTORICAL_MENU_CUTOFF) {
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
  const { authority, sourceKinds } = sourceKindsFor(vendor, targetDate);
  const selected = new Map();
  for (const rawRow of rows) {
    if (text(rawRow.vendor) !== vendor || text(rawRow.effective_date) > targetDate) continue;
    if (!sourceKinds.includes(rawRow.source_kind)) continue;
    const row = normalizedChange(rawRow);
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

export const resolveMenuItemChangesFromRows = (rows = [], options = {}) => {
  const vendor = text(options.vendor);
  const targetDate = text(options.targetDate);
  if (!vendor || !isDateOnly(targetDate)) throw badRequest('MENU_CHANGE_RESOLUTION_INPUT_INVALID');
  return resolveRows(rows, { vendor, targetDate });
};

export const resolveMenuItemChanges = async (database, { vendor, targetDate } = {}) => {
  const normalizedVendor = text(vendor);
  const normalizedDate = text(targetDate);
  if (!normalizedVendor || !isDateOnly(normalizedDate)) {
    throw badRequest('MENU_CHANGE_RESOLUTION_INPUT_INVALID');
  }
  const result = await database.prepare(`
    SELECT menu_item_change_id, effective_date, vendor, item_code, variant_key,
           item_name, price, enabled, image_url, note, display_order,
           source_kind, source_batch_id, source_table, source_row,
           source_record_id, updated_by_user_id, created_at, updated_at
    FROM menu_item_changes
    WHERE vendor = ? AND effective_date <= ?
    ORDER BY effective_date DESC, menu_item_change_id DESC
  `).bind(normalizedVendor, normalizedDate).all();
  return resolveRows(rowsFrom(result), {
    vendor: normalizedVendor,
    targetDate: normalizedDate
  });
};

const materializerRows = (rows) => rows.filter((row) => row.enabled).map((row, index) => ({
  ...row,
  source_order: row.display_order > 0 ? row.display_order : index + 1
}));

export const materializationPlan = ({ vendor, effectiveDate, resolved } = {}) => {
  const normalizedVendor = text(vendor);
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

export const materializeMenuVersion = async (
  database,
  { vendor, effectiveDate, clock = new Date(), resolved = null } = {}
) => {
  const resolution = resolved
    ? { rows: resolved }
    : await resolveMenuItemChanges(database, { vendor, targetDate: effectiveDate });
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
  await runMutationBatch(database, statements);
  return {
    success: true,
    authority: resolution.authority || 'live_with_admin_overrides',
    menuVersionId: plan.menuVersionId,
    effectiveDate: plan.effectiveDate,
    projectedItemCount: plan.rows.length,
    resolvedItemCount: resolution.rows.length
  };
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
  const price = typeof input.price === 'number' ? input.price : Number(text(input.price));
  if (!Number.isSafeInteger(price)) throw badRequest('MENU_CHANGE_PRICE_INVALID');
  if (input.enabled !== undefined && typeof input.enabled !== 'boolean') {
    throw badRequest('MENU_CHANGE_ENABLED_INVALID');
  }
  const displayOrderValue = input.display_order ?? input.displayOrder ?? 0;
  const displayOrder = Number(displayOrderValue);
  if (!Number.isSafeInteger(displayOrder) || displayOrder < 0) {
    throw badRequest('MENU_CHANGE_DISPLAY_ORDER_INVALID');
  }
  return {
    effective_date: effectiveDate,
    vendor: requiredText(input.vendor, 'MENU_CHANGE_VENDOR_REQUIRED'),
    item_code: requiredText(input.item_code ?? input.itemCode, 'MENU_CHANGE_ITEM_CODE_REQUIRED'),
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
  try {
    await runMutationBatch(database, [insert, audit]);
  } catch (error) {
    if (uniqueChangeError(error)) throw conflict('MENU_CHANGE_DUPLICATE');
    throw error;
  }

  // The append is the only persisted change mutation. Projection refresh is
  // deliberately derived from the now-authoritative rows and never updates
  // the change row itself.
  await materializeMenuVersion(database, {
    vendor: values.vendor,
    effectiveDate: values.effective_date,
    clock
  });
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
  const resolution = await resolveMenuItemChanges(database, { vendor, targetDate });
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

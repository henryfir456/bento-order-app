import { ACTIONS, assertCan } from '../auth/permissions.js';
import { auditStatement } from '../db/audit.js';
import {
  prepareStatement,
  randomId,
  resolveClock,
  runMutationBatch
} from '../db/transactions.js';
import { badRequest, notFound } from '../http/errors.js';
import { deadlineInfo, getTaipeiDate, isDateOnly } from './deadlines.js';
import {
  compatibilityVendorCandidates,
  normalizeMenuVendor
} from './menuVendors.js';

const rowsFrom = (result) => (
  Array.isArray(result) ? result : (Array.isArray(result?.results) ? result.results : [])
);

const VENDOR_COLUMNS = `
  vendor_id, name, description, phone, address, website_url,
  menu_source_url, menu_image_url, menu_updated_at, enabled,
  created_at, updated_at
`;

const EDITABLE_FIELDS = Object.freeze([
  'description',
  'phone',
  'address',
  'website_url',
  'menu_source_url',
  'menu_image_url',
  'menu_updated_at',
  'enabled'
]);

const EDITABLE_FIELD_SET = new Set(EDITABLE_FIELDS);
const URL_FIELDS = new Set(['website_url', 'menu_source_url', 'menu_image_url']);

const text = (value) => (typeof value === 'string' ? value.trim() : '');

const urlValue = (value, code) => {
  const normalized = text(value);
  if (!normalized) return '';
  let parsed;
  try {
    parsed = new URL(normalized);
  } catch {
    throw badRequest(code);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw badRequest(code);
  return normalized;
};

const dateValue = (value) => {
  const normalized = text(value);
  if (!normalized) return null;
  if (!isDateOnly(normalized)) throw badRequest('VENDOR_MENU_DATE_INVALID');
  return normalized;
};

const recentGroupFromRow = (row, now) => {
  const orderDate = text(row.order_date);
  if (!isDateOnly(orderDate)) return null;
  const mode = row.mode === 'B' ? 'B' : 'A';
  const info = deadlineInfo(orderDate, mode, now);
  return {
    order_date: orderDate,
    mode,
    deadline: info?.deadline || null,
    is_expired: Boolean(info?.isExpired)
  };
};

const readRecentGroups = async (database, name, now) => {
  const candidates = compatibilityVendorCandidates(normalizeMenuVendor(name));
  const placeholders = candidates.map(() => '?').join(', ');
  const result = await database.prepare(`
    SELECT order_date, vendor, mode
    FROM calendar_settings
    WHERE trim(vendor) IN (${placeholders})
      AND length(trim(vendor)) > 0
    ORDER BY order_date DESC
    LIMIT 5
  `).bind(...candidates).all();
  return rowsFrom(result).map((row) => recentGroupFromRow(row, now)).filter(Boolean);
};

const withOpenOrdering = (row, recentGroups, now) => {
  const today = getTaipeiDate(now);
  const isOpenForOrdering = Number(row.enabled) === 1 && recentGroups.some((group) => (
    group.order_date >= today && !group.is_expired
  ));
  return {
    id: row.vendor_id,
    name: normalizeMenuVendor(text(row.name)),
    description: text(row.description),
    phone: text(row.phone),
    address: text(row.address),
    website_url: text(row.website_url),
    menu_source_url: text(row.menu_source_url),
    menu_image_url: text(row.menu_image_url),
    menu_updated_at: isDateOnly(text(row.menu_updated_at)) ? text(row.menu_updated_at) : null,
    enabled: Number(row.enabled) === 1,
    is_open_for_ordering: isOpenForOrdering,
    recent_groups: recentGroups,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null
  };
};

export const vendorFromRow = (row, recentGroups = [], now = new Date()) => (
  row ? withOpenOrdering(row, recentGroups, now) : null
);

const readVendorRows = async (database, where = '', bindings = []) => {
  const result = await database.prepare(`
    SELECT ${VENDOR_COLUMNS}
    FROM vendors
    ${where}
  `).bind(...bindings).all();
  return rowsFrom(result);
};

const readVendor = async (database, vendorId) => {
  const rows = await readVendorRows(database, 'WHERE vendor_id = ? LIMIT 1', [vendorId]);
  return rows[0] || null;
};

const normalizeVendor = async (database, row, now) => (
  vendorFromRow(row, await readRecentGroups(database, row.name, now), now)
);

export const listVendors = async (database, { now = new Date() } = {}) => {
  const rows = await readVendorRows(database, 'ORDER BY enabled DESC, name ASC, vendor_id ASC');
  const canonicalRows = new Map();
  rows.forEach((row) => {
    const rawName = text(row.name);
    const canonicalName = normalizeMenuVendor(rawName);
    const existing = canonicalRows.get(canonicalName);
    const isCanonical = rawName === canonicalName;
    const existingIsCanonical = existing && text(existing.name) === canonicalName;
    if (!existing || (isCanonical && !existingIsCanonical)) canonicalRows.set(canonicalName, row);
  });
  return {
    vendors: (await Promise.all([...canonicalRows.values()].map((row) => normalizeVendor(database, row, now))))
      .filter(Boolean)
  };
};

export const getVendor = async (database, vendorId, { now = new Date() } = {}) => {
  const row = await readVendor(database, vendorId);
  if (!row) throw notFound('VENDOR_NOT_FOUND');
  return normalizeVendor(database, row, now);
};

const assertKnownFields = (input) => {
  if (Object.keys(input).some((field) => !EDITABLE_FIELD_SET.has(field))) {
    throw badRequest('VENDOR_UNKNOWN_FIELD');
  }
  if (Object.keys(input).length === 0) throw badRequest('VENDOR_PATCH_EMPTY');
};

const patchInput = (input) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw badRequest('INVALID_JSON');
  }
  assertKnownFields(input);
  const patch = {};
  for (const field of EDITABLE_FIELDS) {
    if (!(field in input)) continue;
    if (field === 'enabled') {
      if (typeof input[field] !== 'boolean') throw badRequest('VENDOR_ENABLED_INVALID');
      patch[field] = input[field];
    } else if (URL_FIELDS.has(field)) {
      patch[field] = urlValue(input[field], 'VENDOR_URL_INVALID');
    } else if (field === 'menu_updated_at') {
      patch[field] = dateValue(input[field]);
    } else {
      patch[field] = text(input[field]);
    }
  }
  return patch;
};

export const updateVendor = async (
  database,
  identity,
  vendorId,
  input,
  clock = new Date()
) => {
  assertCan(identity, ACTIONS.ADMIN_VENDORS);
  const existing = await readVendor(database, vendorId);
  if (!existing) throw notFound('VENDOR_NOT_FOUND');
  const patch = patchInput(input);
  const occurredAt = resolveClock(clock).toISOString();
  const assignments = [];
  const bindings = [];
  for (const field of EDITABLE_FIELDS) {
    if (!(field in patch)) continue;
    assignments.push(`${field} = ?`);
    bindings.push(field === 'enabled' ? (patch[field] ? 1 : 0) : patch[field]);
  }
  assignments.push('updated_at = ?');
  bindings.push(occurredAt, vendorId);

  const update = prepareStatement(database, `
    UPDATE vendors
    SET ${assignments.join(', ')}
    WHERE vendor_id = ?
  `, bindings);
  const audit = auditStatement(database, {
    auditId: randomId('audit'),
    actorUserId: identity.actor.userId,
    actorAuthMode: identity.actor.authMode,
    actorEmployeeIdSnapshot: identity.actor.employeeId,
    actorLineUserIdSnapshot: identity.actor.lineUserId,
    action: 'VENDOR_UPDATED',
    metadata: { vendorId, fields: Object.keys(patch) },
    occurredAt
  });
  await runMutationBatch(database, [update, audit]);
  return getVendor(database, vendorId, { now: resolveClock(clock) });
};

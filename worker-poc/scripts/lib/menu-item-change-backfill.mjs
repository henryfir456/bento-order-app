import {
  ImportContractError,
  asText,
  batchIdFor,
  stableId
} from './import-contract.mjs';
import { buildHistoricalMenuSnapshots } from './historical-menu-reconstruction.mjs';
import { AP_VARIANT_KEYS as DOMAIN_AP_VARIANT_KEYS } from '../../src/domain/menuItemChanges.js';
import { isDateOnly } from '../../src/domain/deadlines.js';
import { prepareStatement, resolveClock, runMutationBatch } from '../../src/db/transactions.js';

export const SQL_CHANGE_SOURCE_KIND = 'legacy_sql';
export const GAS_CHANGE_SOURCE_KIND = 'gas_compatibility';
export const AP_VARIANT_KEYS = DOMAIN_AP_VARIANT_KEYS;

const text = (value) => asText(value).trim();

const dateForPeriod = (period) => {
  const value = text(period);
  if (!/^\d{6}$/.test(value)) return null;
  const month = Number(value.slice(4));
  if (month < 1 || month > 12) return null;
  return `${value.slice(0, 4)}-${value.slice(4)}-01`;
};

const sourceIdFor = (row) => text(
  row?.sourceRecordId ?? row?.source_record_id ?? row?.source?.sourceId
);

const rowIdentity = (row) => [
  text(row.vendor),
  text(row.item_code ?? row.itemCode),
  text(row.variant_key ?? row.variantKey),
  text(row.effective_date ?? row.effectiveDate)
].join('\u0000');

const assertNoCollisions = (rows) => {
  const seen = new Map();
  const collisions = [];
  for (const row of rows) {
    const key = rowIdentity(row);
    const previous = seen.get(key);
    if (previous) {
      collisions.push({
        key,
        first: previous.menu_item_change_id || previous.source_record_id || null,
        duplicate: row.menu_item_change_id || row.source_record_id || null
      });
    } else {
      seen.set(key, row);
    }
  }
  if (collisions.length) {
    throw new ImportContractError(
      'MENU_ITEM_CHANGE_IDENTITY_COLLISION',
      `Menu item change identity has ${collisions.length} collision(s).`,
      { collisions }
    );
  }
  return rows;
};

const sqlChangeFor = ({ fact, snapshot, sourceHash, vendor }) => {
  const item = snapshot.items.find((candidate) => candidate.legacyItemId === fact.type);
  if (!item) throw new ImportContractError('SQL_MENU_CHANGE_ITEM_MISSING', 'SQL item is absent from its reconstructed snapshot.');
  const sourceRow = Number(fact.source?.sourceRow || 0);
  const sourceRecordId = text(fact.source?.sourceId) || `bento_price:${sourceRow}`;
  return {
    menu_item_change_id: stableId(
      'legacy-sql-menu-change', sourceHash, vendor, snapshot.period, fact.type, sourceRecordId
    ),
    effective_date: snapshot.effectiveDate,
    vendor,
    item_code: fact.type,
    variant_key: '',
    item_name: fact.name,
    price: fact.price,
    enabled: 1,
    image_url: '',
    note: '',
    display_order: item.sourceOrder,
    source_kind: SQL_CHANGE_SOURCE_KIND,
    source_batch_id: batchIdFor(sourceHash, 'legacy-sql-menu'),
    source_table: fact.source?.sourceTable || 'bento_price',
    source_row: sourceRow,
    source_record_id: sourceRecordId,
    updated_by_user_id: null
  };
};

export const buildSqlMenuItemChanges = ({
  facts = [],
  sourceHash = 'unknown-source',
  vendor = '蔡老師'
} = {}) => {
  const reconstruction = buildHistoricalMenuSnapshots({ facts, sourceHash, vendor });
  const snapshotsByDate = new Map(reconstruction.snapshots.map((snapshot) => [snapshot.period, snapshot]));
  const sourceFacts = new Map();
  for (const snapshot of reconstruction.snapshots) {
    for (const item of snapshot.items) {
      if (!item.source?.sourceRow) continue;
      const sourceRecordId = text(item.source.sourceId) || `bento_price:${item.source.sourceRow}`;
      if (!sourceFacts.has(sourceRecordId)) {
        sourceFacts.set(sourceRecordId, {
          period: snapshot.period,
          type: item.legacyItemId,
          name: item.itemName,
          price: item.price,
          source: item.source
        });
      }
    }
  }
  const rows = [];
  for (const fact of sourceFacts.values()) {
    const snapshot = snapshotsByDate.get(fact.period);
    rows.push(sqlChangeFor({ fact, snapshot, sourceHash, vendor }));
  }
  // The reconstruction emits each source fact once through its source row.
  assertNoCollisions(rows);
  return {
    rows,
    summary: {
      sourceFacts: facts.length,
      changeRows: rows.length,
      periods: reconstruction.summary.periods,
      duplicateCount: reconstruction.summary.duplicateCount,
      invalidCount: reconstruction.summary.invalidCount,
      snapshotCounts: reconstruction.snapshots.map((snapshot) => ({
        period: snapshot.period,
        itemCount: snapshot.items.length
      })),
      revert1: reconstruction.summary.revert1
    },
    reconstruction
  };
};

const apRows = (rows) => rows.filter((row) => (
  text(row.item_code ?? row.itemCode).toUpperCase() === 'AP'
));

export const buildGasApVariantMapping = (rows = [], { explicit = null } = {}) => {
  const sourceIds = [...new Set(apRows(rows).map(sourceIdFor))].sort();
  if (sourceIds.some((sourceId) => !sourceId)) {
    throw new ImportContractError(
      'GAS_AP_SOURCE_ID_REQUIRED',
      'Every GAS AP row requires a stable source_record_id before backfill.'
    );
  }
  if (sourceIds.length === 0) {
    return Object.freeze({
      code: 'AP',
      mappings: [],
      bySourceRecordId: Object.freeze({})
    });
  }
  if (sourceIds.length !== 2) {
    throw new ImportContractError(
      'GAS_AP_VARIANT_COUNT_INVALID',
      'GAS compatibility backfill requires exactly two distinct AP source identities.',
      { sourceIds }
    );
  }
  if (!explicit) {
    throw new ImportContractError(
      'GAS_AP_VARIANT_MAPPING_REQUIRED',
      'AP backfill requires an explicit source-identity to variant_key mapping.',
      { sourceIds }
    );
  }
  const mapping = explicit;
  const mapped = sourceIds.map((sourceId) => ({
    source_record_id: sourceId,
    variant_key: text(mapping[sourceId])
  }));
  if (mapped.some((item) => !AP_VARIANT_KEYS.includes(item.variant_key))
    || new Set(mapped.map((item) => item.variant_key)).size !== 2) {
    throw new ImportContractError(
      'GAS_AP_VARIANT_MAPPING_INVALID',
      'GAS AP variants must map one-to-one to the two stable AP variant keys.',
      { mappings: mapped }
    );
  }
  return Object.freeze({
    code: 'AP',
    mappings: mapped,
    bySourceRecordId: Object.freeze(Object.fromEntries(
      mapped.map((item) => [item.source_record_id, item.variant_key])
    ))
  });
};

const gasRowDate = (row) => {
  const effectiveDate = text(row.effective_date ?? row.effectiveDate);
  if (effectiveDate) return effectiveDate;
  return dateForPeriod(row.yymm_bento ?? row.yymmBento);
};

export const buildGasCompatibilityChanges = ({
  rows = [],
  apVariantMapping = null,
  sourceLabel = 'gas_compatibility'
} = {}) => {
  const mapping = buildGasApVariantMapping(rows, { explicit: apVariantMapping });
  const changes = rows.map((row) => {
    const vendor = text(row.vendor);
    const itemCode = text(row.item_code ?? row.itemCode);
    const effectiveDate = gasRowDate(row);
    const sourceRecordId = sourceIdFor(row);
    if (!vendor || !itemCode || !effectiveDate || !isDateOnly(effectiveDate)) {
      throw new ImportContractError('GAS_MENU_CHANGE_INVALID', 'GAS compatibility row is incomplete.', { row });
    }
    if (!sourceRecordId) {
      throw new ImportContractError('GAS_SOURCE_ID_REQUIRED', 'GAS compatibility rows require source_record_id.', { row });
    }
    const variantKey = itemCode.toUpperCase() === 'AP'
      ? mapping.bySourceRecordId[sourceRecordId]
      : text(row.variant_key ?? row.variantKey);
    if (itemCode.toUpperCase() === 'AP' && !variantKey) {
      throw new ImportContractError('GAS_AP_VARIANT_MAPPING_REQUIRED', 'AP requires an explicit resolved source identity.');
    }
    const rawPrice = row.price;
    if (rawPrice === null || rawPrice === undefined
      || (typeof rawPrice === 'string' && !rawPrice.trim())) {
      throw new ImportContractError('GAS_MENU_CHANGE_PRICE_INVALID', 'GAS compatibility price is missing.', { row });
    }
    const price = typeof rawPrice === 'number'
      ? rawPrice
      : (typeof rawPrice === 'string' ? Number(rawPrice.trim()) : NaN);
    if (!Number.isSafeInteger(price)) {
      throw new ImportContractError('GAS_MENU_CHANGE_PRICE_INVALID', 'GAS compatibility price must be a safe integer.');
    }
    return {
      menu_item_change_id: stableId('gas-menu-change', vendor, effectiveDate, itemCode, variantKey, sourceRecordId),
      effective_date: effectiveDate,
      vendor,
      item_code: itemCode,
      variant_key: variantKey || '',
      item_name: text(row.item_name ?? row.itemName),
      price,
      enabled: row.enabled === false || row.enabled === 0 ? 0 : 1,
      image_url: text(row.image_url ?? row.imageUrl),
      note: text(row.note),
      display_order: Number.isSafeInteger(Number(row.display_order ?? row.displayOrder))
        ? Number(row.display_order ?? row.displayOrder)
        : 0,
      source_kind: GAS_CHANGE_SOURCE_KIND,
      source_batch_id: null,
      source_table: text(row.source_table ?? row.sourceTable) || sourceLabel,
      source_row: row.source_row ?? row.sourceRow ?? null,
      source_record_id: sourceRecordId,
      updated_by_user_id: null
    };
  });
  assertNoCollisions(changes);
  return {
    rows: changes,
    summary: {
      sourceRows: rows.length,
      changeRows: changes.length,
      apVariantMapping: mapping.mappings
    },
    apVariantMapping: mapping
  };
};

export const reconcileMenuItemChangeRows = ({ sqlRows = [], gasRows = [] } = {}) => {
  const rows = [...sqlRows, ...gasRows];
  assertNoCollisions(rows);
  return {
    sqlCount: sqlRows.length,
    gasCount: gasRows.length,
    totalCount: rows.length,
    collisionCount: 0,
    uniqueIdentityCount: new Set(rows.map(rowIdentity)).size
  };
};

export const buildMenuItemChangeBackfillReport = ({ sql, gas } = {}) => ({
  sql: sql?.summary || null,
  gas: gas?.summary || null,
  reconciliation: reconcileMenuItemChangeRows({
    sqlRows: sql?.rows || [],
    gasRows: gas?.rows || []
  })
});

export const buildMenuItemChangeBackfill = ({
  sqlFacts = [],
  gasRows = [],
  sourceHash = 'unknown-source',
  vendor = '蔡老師',
  apVariantMapping = null
} = {}) => {
  const sql = buildSqlMenuItemChanges({ facts: sqlFacts, sourceHash, vendor });
  const gas = buildGasCompatibilityChanges({
    rows: gasRows,
    apVariantMapping
  });
  return {
    sql,
    gas,
    report: buildMenuItemChangeBackfillReport({ sql, gas })
  };
};

const storedFields = [
  'effective_date', 'vendor', 'item_code', 'variant_key', 'item_name', 'price',
  'enabled', 'image_url', 'note', 'display_order', 'source_kind',
  'source_batch_id', 'source_table', 'source_row', 'source_record_id'
];

const storedValue = (row, field) => (
  field === 'enabled' ? Number(row[field]) : (row[field] ?? null)
);

const persistedPrice = (row) => {
  const rawPrice = row?.price;
  if (rawPrice === null || rawPrice === undefined
    || (typeof rawPrice === 'string' && !rawPrice.trim())) {
    throw new ImportContractError('MENU_CHANGE_PRICE_INVALID', 'Menu item change price is missing.', { row });
  }
  const price = typeof rawPrice === 'number'
    ? rawPrice
    : (typeof rawPrice === 'string' ? Number(rawPrice.trim()) : NaN);
  if (!Number.isSafeInteger(price)) {
    throw new ImportContractError('MENU_CHANGE_PRICE_INVALID', 'Menu item change price must be a safe integer.', { row });
  }
  return price;
};

const validatePersistedRow = (row) => {
  const effectiveDate = text(row?.effective_date ?? row?.effectiveDate);
  if (!isDateOnly(effectiveDate)) {
    throw new ImportContractError(
      'MENU_CHANGE_EFFECTIVE_DATE_INVALID',
      'Menu item change effective_date must be a valid calendar date.',
      { row }
    );
  }
  const itemCode = text(row?.item_code ?? row?.itemCode);
  const variantKey = text(row?.variant_key ?? row?.variantKey);
  if (itemCode.toUpperCase() === 'AP' && !AP_VARIANT_KEYS.includes(variantKey)) {
    throw new ImportContractError(
      'MENU_CHANGE_VARIANT_KEY_REQUIRED',
      'Ambiguous AP menu item changes require a canonical variant_key.',
      { row }
    );
  }
  return {
    ...row,
    effective_date: effectiveDate,
    item_code: itemCode,
    variant_key: variantKey,
    price: persistedPrice(row)
  };
};

const backfillEquivalent = (existing, row) => storedFields.every((field) => (
  storedValue(existing, field) === storedValue(row, field)
));

export const backfillMenuItemChanges = async (
  database,
  rows = [],
  { clock = new Date() } = {}
) => {
  const validatedRows = rows.map(validatePersistedRow);
  assertNoCollisions(validatedRows);
  const insertRows = [];
  let alreadyEquivalent = 0;
  const conflicts = [];
  for (const row of validatedRows) {
    const existing = await database.prepare(`
      SELECT menu_item_change_id, effective_date, vendor, item_code, variant_key,
             item_name, price, enabled, image_url, note, display_order,
             source_kind, source_batch_id, source_table, source_row, source_record_id
      FROM menu_item_changes
      WHERE vendor = ? AND item_code = ? AND variant_key = ? AND effective_date = ?
      LIMIT 1
    `).bind(row.vendor, row.item_code, row.variant_key || '', row.effective_date).first();
    if (!existing) {
      insertRows.push(row);
    } else if (backfillEquivalent(existing, row)) {
      alreadyEquivalent += 1;
    } else {
      conflicts.push({
        identity: rowIdentity(row),
        existingId: existing.menu_item_change_id,
        incomingId: row.menu_item_change_id
      });
    }
  }
  if (conflicts.length) {
    throw new ImportContractError(
      'MENU_ITEM_CHANGE_BACKFILL_CONFLICT',
      `Menu item change backfill has ${conflicts.length} conflict(s).`,
      { conflicts }
    );
  }
  if (!insertRows.length) {
    return { inserted: 0, alreadyEquivalent, conflicts: [] };
  }
  const occurredAt = resolveClock(clock).toISOString();
  const statements = insertRows.map((row) => prepareStatement(database, `
    INSERT INTO menu_item_changes (
      menu_item_change_id, effective_date, vendor, item_code, variant_key,
      item_name, price, enabled, image_url, note, display_order,
      source_kind, source_batch_id, source_table, source_row,
      source_record_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    row.menu_item_change_id,
    row.effective_date,
    row.vendor,
    row.item_code,
    row.variant_key || '',
    row.item_name,
    row.price,
    Number(row.enabled) ? 1 : 0,
    row.image_url || '',
    row.note || '',
    Number(row.display_order || 0),
    row.source_kind,
    row.source_batch_id || null,
    row.source_table || null,
    row.source_row ?? null,
    row.source_record_id || null,
    occurredAt,
    occurredAt
  ]));
  await runMutationBatch(database, statements);
  return { inserted: insertRows.length, alreadyEquivalent, conflicts: [] };
};

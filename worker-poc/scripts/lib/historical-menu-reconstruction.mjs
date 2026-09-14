import {
  ImportContractError,
  asText,
  batchIdFor,
  stableId
} from './import-contract.mjs';

export const HISTORICAL_MENU_VENDOR = '蔡老師';
export const HISTORICAL_MENU_CUTOFF = '2026-09-10';
export const HISTORICAL_MENU_IMPORTER_VERSION = 'legacy-sql-menu';

const periodPattern = /^(\d{4})(\d{2})$/;

const compareText = (left, right) => {
  const leftText = asText(left);
  const rightText = asText(right);
  if (leftText < rightText) return -1;
  if (leftText > rightText) return 1;
  return 0;
};

const periodToEffectiveDate = (period) => {
  const match = periodPattern.exec(period);
  if (!match) return null;
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return `${match[1]}-${match[2]}-01`;
};

const sourceLocation = (fact) => ({
  sourceTable: asText(fact?.sourceTable).trim() || 'bento_price',
  sourceRow: Number(fact?.sourceRow || 0),
  sourceId: fact?.sourceId ?? null
});

const factKey = (fact) => `${asText(fact?.yymmBento).trim()}|${asText(fact?.type).trim()}`;

const invalidFact = (fact, reason) => ({
  ...sourceLocation(fact),
  reason,
  yymmBento: asText(fact?.yymmBento).trim() || null,
  type: asText(fact?.type).trim() || null,
  name: asText(fact?.name).trim() || null,
  price: fact?.price ?? null
});

const normalizeFact = (fact) => {
  const period = asText(fact?.yymmBento).trim();
  const type = asText(fact?.type).trim();
  const name = asText(fact?.name).trim();
  if (!periodToEffectiveDate(period)) return { invalid: invalidFact(fact, 'INVALID_PERIOD') };
  if (!type || !name) return { invalid: invalidFact(fact, 'INVALID_MENU_ITEM') };
  if (!Number.isSafeInteger(fact?.price)) return { invalid: invalidFact(fact, 'INVALID_SIGNED_PRICE') };
  return {
    fact: {
      period,
      type,
      name,
      price: fact.price,
      source: sourceLocation(fact)
    }
  };
};

const equivalentFact = (left, right) => (
  left.name === right.name && left.price === right.price
);

const itemFor = ({ sourceHash, vendor, period, fact, sourceOrder, menuVersionId }) => ({
  menuItemId: stableId('legacy-sql-menu-item', sourceHash, vendor, period, fact.type),
  menuVersionId,
  legacyItemId: fact.type,
  itemName: fact.name,
  price: fact.price,
  enabled: true,
  note: '',
  imageUrl: '',
  sourceOrder,
  source: fact.source
});

export const buildHistoricalMenuSnapshots = ({
  facts = [],
  sourceHash = 'unknown-source',
  vendor = HISTORICAL_MENU_VENDOR
} = {}) => {
  const byPeriod = new Map();
  const invalidSource = [];
  const duplicateFacts = [];

  for (const rawFact of facts) {
    const normalized = normalizeFact(rawFact);
    if (normalized.invalid) {
      invalidSource.push(normalized.invalid);
      continue;
    }
    const fact = normalized.fact;
    const periodFacts = byPeriod.get(fact.period) || new Map();
    const existing = periodFacts.get(fact.type);
    if (existing) {
      const duplicate = {
        key: factKey(fact),
        first: existing.source,
        duplicate: fact.source,
        equivalent: equivalentFact(existing, fact)
      };
      duplicateFacts.push(duplicate);
      if (!duplicate.equivalent) {
        throw new ImportContractError(
          'HISTORICAL_MENU_DUPLICATE_CONFLICT',
          `Conflicting SQL menu facts for ${duplicate.key}.`
        );
      }
      continue;
    }
    periodFacts.set(fact.type, fact);
    byPeriod.set(fact.period, periodFacts);
  }

  if (invalidSource.length) {
    throw new ImportContractError(
      'HISTORICAL_MENU_SOURCE_INVALID',
      `Historical SQL menu source contains ${invalidSource.length} invalid row(s).`
    );
  }

  const state = new Map();
  const snapshots = [];
  for (const period of [...byPeriod.keys()].sort()) {
    for (const fact of byPeriod.get(period).values()) state.set(fact.type, fact);
    const effectiveDate = periodToEffectiveDate(period);
    const menuVersionId = stableId(
      'legacy-sql-menu-version',
      sourceHash,
      vendor,
      period
    );
    const items = [...state.values()]
      .sort((left, right) => compareText(left.type, right.type))
      .map((fact, index) => itemFor({
        sourceHash,
        vendor,
        period,
        fact,
        sourceOrder: index + 1,
        menuVersionId
      }));
    snapshots.push({
      menuVersionId,
      vendor,
      period,
      effectiveDate,
      sourceBatchId: batchIdFor(sourceHash, HISTORICAL_MENU_IMPORTER_VERSION),
      importerVersion: HISTORICAL_MENU_IMPORTER_VERSION,
      items
    });
  }

  const menuVersions = snapshots.map((snapshot) => ({
    menuVersionId: snapshot.menuVersionId,
    vendor: snapshot.vendor,
    effectiveDate: snapshot.effectiveDate,
    sourceBatchId: snapshot.sourceBatchId,
    importerVersion: snapshot.importerVersion
  }));
  const menuItems = snapshots.flatMap((snapshot) => snapshot.items);
  return {
    vendor,
    cutoff: HISTORICAL_MENU_CUTOFF,
    snapshots,
    menuVersions,
    menuItems,
    invalidSource,
    duplicateFacts,
    summary: {
      sourceFacts: facts.length,
      periods: snapshots.map((snapshot) => snapshot.period),
      versionCount: menuVersions.length,
      itemCount: menuItems.length,
      duplicateCount: duplicateFacts.length,
      invalidCount: invalidSource.length,
      revert1: snapshots
        .filter((snapshot) => ['202608', '202609'].includes(snapshot.period))
        .map((snapshot) => snapshot.items.find((item) => item.legacyItemId === 'revert1')?.price ?? null)
    }
  };
};

const menuItemEquivalent = (left, right) => (
  asText(left?.legacyItemId ?? left?.legacy_item_id) === asText(right?.legacyItemId ?? right?.legacy_item_id)
  && asText(left?.itemName ?? left?.item_name) === asText(right?.itemName ?? right?.item_name)
  && Number(left?.price) === Number(right?.price)
  && Boolean(left?.enabled ?? true) === Boolean(right?.enabled ?? true)
  && asText(left?.note) === asText(right?.note)
  && asText(left?.imageUrl ?? left?.image_url) === asText(right?.imageUrl ?? right?.image_url)
);

const menuKey = (vendor, effectiveDate) => `${vendor}|${effectiveDate}`;

export const reconcileHistoricalMenu = ({ desired, existingVersions = [], existingItems = [] } = {}) => {
  const versionByKey = new Map(existingVersions.map((row) => [menuKey(row.vendor, row.effectiveDate ?? row.effective_date), row]));
  const itemsByVersion = new Map();
  for (const item of existingItems) {
    const list = itemsByVersion.get(item.menuVersionId ?? item.menu_version_id) || [];
    list.push(item);
    itemsByVersion.set(item.menuVersionId ?? item.menu_version_id, list);
  }

  const insertNew = { menuVersions: 0, menuItems: 0 };
  const alreadyEquivalent = { menuVersions: 0, menuItems: 0 };
  const conflicts = [];
  for (const snapshot of desired?.snapshots || []) {
    const existingVersion = versionByKey.get(menuKey(snapshot.vendor, snapshot.effectiveDate));
    if (!existingVersion) {
      insertNew.menuVersions += 1;
      insertNew.menuItems += snapshot.items.length;
      continue;
    }
    const currentItems = itemsByVersion.get(existingVersion.menuVersionId ?? existingVersion.menu_version_id) || [];
    const currentByType = new Map(currentItems.map((item) => [item.legacyItemId ?? item.legacy_item_id, item]));
    const targetByType = new Map(snapshot.items.map((item) => [item.legacyItemId, item]));
    const mismatchTypes = [...new Set([
      ...currentByType.keys(),
      ...targetByType.keys()
    ])].filter((type) => !menuItemEquivalent(currentByType.get(type), targetByType.get(type)));
    if (mismatchTypes.length) {
      conflicts.push({
        vendor: snapshot.vendor,
        effectiveDate: snapshot.effectiveDate,
        menuVersionId: existingVersion.menuVersionId ?? existingVersion.menu_version_id,
        legacyItemIds: mismatchTypes.sort()
      });
      continue;
    }
    alreadyEquivalent.menuVersions += 1;
    alreadyEquivalent.menuItems += snapshot.items.length;
  }
  return {
    insertNew,
    alreadyEquivalent,
    conflicts,
    mutationCount: insertNew.menuVersions + insertNew.menuItems
  };
};

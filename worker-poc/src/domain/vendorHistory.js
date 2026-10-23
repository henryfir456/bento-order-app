import { auditStatement } from '../db/audit.js';
import { prepareStatement, runMutationBatch } from '../db/transactions.js';
import { conflict } from '../http/errors.js';
import { getTaipeiDate } from './deadlines.js';
import { compatibilityVendorCandidates } from './menuVendors.js';

// Historical import for a vendor: an Admin confirms that this vendor's past
// menu versions (by menu_versions.vendor name, before today) belong to it.
// Each confirmation is one append-only VERIFIED mapping event, after which
// vendor_order_vendor_attributions attributes the legacy orders on its own.
// Versions that already have any mapping event (verified or revoked) are
// left alone so an earlier decision is never overridden. Shop-name mappings
// (migration 0022) also attribute legacy orders whose lines lack a verified
// menu identity, so the vendor sees whole legacy orders.

const candidateVersionsSql = (vendorNames) => `
  SELECT mv.menu_version_id, mv.effective_date
  FROM menu_versions mv
  WHERE mv.vendor IN (${vendorNames.map(() => '?').join(', ')})
    AND mv.effective_date < ?
    AND NOT EXISTS (
      SELECT 1 FROM vendor_menu_version_mapping_events existing
      WHERE existing.menu_version_id = mv.menu_version_id
    )
`;

const rowsFrom = (result) => (Array.isArray(result?.results) ? result.results : []);

const candidateParams = (vendor, now) => {
  const vendorNames = compatibilityVendorCandidates(vendor.name);
  return { vendorNames, params: [...vendorNames, getTaipeiDate(now)] };
};

// Shop names (current and compatibility names) whose legacy orders are not yet
// attributed by a reviewed name mapping (none, revoked, or an earlier date).
const pendingNamesSql = (vendorNames) => `
  SELECT candidate.value AS vendor_name
  FROM json_each(?) candidate
  WHERE NOT EXISTS (
    SELECT 1 FROM vendor_legacy_name_mapping_events existing
    WHERE existing.vendor_name = candidate.value
      AND existing.revision = (
        SELECT MAX(latest.revision) FROM vendor_legacy_name_mapping_events latest
        WHERE latest.vendor_name = candidate.value
      )
      AND existing.mapping_status = 'VERIFIED'
      AND existing.before_date >= ?
  )
`;

export const previewVendorHistoryImport = async (database, vendor, now = new Date()) => {
  const { vendorNames, params } = candidateParams(vendor, now);
  const today = getTaipeiDate(now);
  const namesJson = JSON.stringify(vendorNames);
  const [versions, names, orders] = await Promise.all([
    database.prepare(`
      SELECT COUNT(*) AS version_count, MIN(effective_date) AS first_date, MAX(effective_date) AS last_date
      FROM (${candidateVersionsSql(vendorNames)})
    `).bind(...params).first(),
    database.prepare(`SELECT vendor_name FROM (${pendingNamesSql(vendorNames)})`)
      .bind(namesJson, today).all(),
    // Orders that would become attributed: legacy ACTIVE orders before today,
    // recorded under one of the shop names (or with a line from a candidate
    // menu version), with no attribution yet.
    database.prepare(`
      WITH candidate AS (${candidateVersionsSql(vendorNames)})
      SELECT COUNT(DISTINCT o.order_id) AS order_count,
        COUNT(DISTINCT o.order_date) AS day_count,
        MIN(o.order_date) AS first_order_date,
        MAX(o.order_date) AS last_order_date
      FROM orders o
      WHERE o.status = 'ACTIVE'
        AND o.order_date < ?
        AND (
          trim(o.vendor) IN (SELECT value FROM json_each(?))
          OR EXISTS (
            SELECT 1 FROM order_items oi
            JOIN menu_items mi ON mi.menu_item_id = oi.menu_item_id
            JOIN candidate c ON c.menu_version_id = mi.menu_version_id
            WHERE oi.order_id = o.order_id AND c.effective_date <= o.order_date
          )
        )
        AND NOT EXISTS (
          SELECT 1 FROM canonical_order_vendor_assignments direct
          WHERE direct.order_id = o.order_id
        )
        AND NOT EXISTS (
          SELECT 1 FROM vendor_order_vendor_attributions attributed
          WHERE attributed.order_id = o.order_id
        )
    `).bind(...params, today, namesJson).first()
  ]);
  const pendingNames = rowsFrom(names).map((row) => row.vendor_name);
  return {
    success: true,
    vendor: { id: vendor.vendor_id, name: vendor.name },
    menuVersionNames: vendorNames,
    versionCount: Number(versions?.version_count || 0),
    firstVersionDate: versions?.first_date || null,
    lastVersionDate: versions?.last_date || null,
    nameCount: pendingNames.length,
    beforeDate: today,
    orderCount: Number(orders?.order_count || 0),
    dayCount: Number(orders?.day_count || 0),
    firstOrderDate: orders?.first_order_date || null,
    lastOrderDate: orders?.last_order_date || null
  };
};

export const applyVendorHistoryImport = async (database, identity, vendor, expected, now = new Date()) => {
  const preview = await previewVendorHistoryImport(database, vendor, now);
  const { versions: expectedVersions, names: expectedNames } = expected;
  if (!Number.isSafeInteger(expectedVersions) || expectedVersions !== preview.versionCount
    || !Number.isSafeInteger(expectedNames) || expectedNames !== preview.nameCount) {
    throw conflict('VENDOR_HISTORY_PREVIEW_STALE');
  }
  if (preview.versionCount === 0 && preview.nameCount === 0) {
    return { ...preview, importedVersions: 0, importedNames: 0 };
  }
  const { vendorNames, params } = candidateParams(vendor, now);
  const reviewedAt = now.toISOString();
  const versionInsert = prepareStatement(database, `
    INSERT INTO vendor_menu_version_mapping_events (
      event_id, menu_version_id, revision, vendor_id, effective_date,
      mapping_status, evidence_kind, reviewed_by_user_id, reviewed_at
    )
    SELECT 'vendor_mapping_' || lower(hex(randomblob(16))), candidate.menu_version_id, 1, ?,
      candidate.effective_date, 'VERIFIED', 'MENU_VERSION_ID_EFFECTIVE_DATE', ?, ?
    FROM (${candidateVersionsSql(vendorNames)}) candidate
  `, [vendor.vendor_id, identity.actor.userId, reviewedAt, ...params]);
  const nameInsert = prepareStatement(database, `
    INSERT INTO vendor_legacy_name_mapping_events (
      event_id, vendor_name, revision, vendor_id, before_date,
      mapping_status, reviewed_by_user_id, reviewed_at
    )
    SELECT 'vendor_name_mapping_' || lower(hex(randomblob(16))), pending.vendor_name,
      COALESCE((SELECT MAX(previous.revision) FROM vendor_legacy_name_mapping_events previous
        WHERE previous.vendor_name = pending.vendor_name), 0) + 1,
      ?, ?, 'VERIFIED', ?, ?
    FROM (${pendingNamesSql(vendorNames)}) pending
  `, [vendor.vendor_id, preview.beforeDate, identity.actor.userId, reviewedAt,
    JSON.stringify(vendorNames), preview.beforeDate]);
  const audit = auditStatement(database, {
    actorUserId: identity.actor.userId,
    actorAuthMode: identity.actor.authMode,
    action: 'VENDOR_HISTORY_MAPPINGS_VERIFIED',
    metadata: {
      vendorId: vendor.vendor_id,
      versionCount: preview.versionCount,
      firstVersionDate: preview.firstVersionDate,
      lastVersionDate: preview.lastVersionDate,
      nameCount: preview.nameCount,
      beforeDate: preview.beforeDate
    },
    occurredAt: reviewedAt
  });
  await runMutationBatch(database, [versionInsert, nameInsert, audit]);
  return { ...preview, importedVersions: preview.versionCount, importedNames: preview.nameCount };
};

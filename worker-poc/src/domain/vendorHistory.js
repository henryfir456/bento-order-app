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
// left alone so an earlier decision is never overridden.

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

const candidateParams = (vendor, now) => {
  const vendorNames = compatibilityVendorCandidates(vendor.name);
  return { vendorNames, params: [...vendorNames, getTaipeiDate(now)] };
};

export const previewVendorHistoryImport = async (database, vendor, now = new Date()) => {
  const { vendorNames, params } = candidateParams(vendor, now);
  const versions = await database.prepare(`
    SELECT COUNT(*) AS version_count, MIN(effective_date) AS first_date, MAX(effective_date) AS last_date
    FROM (${candidateVersionsSql(vendorNames)})
  `).bind(...params).first();
  // Approximate: orders with at least one item from a candidate version and
  // no vendor attribution yet. Orders that mix vendors stay unattributed.
  const orders = await database.prepare(`
    WITH candidate AS (${candidateVersionsSql(vendorNames)})
    SELECT COUNT(DISTINCT o.order_id) AS order_count,
      COUNT(DISTINCT o.order_date) AS day_count,
      MIN(o.order_date) AS first_order_date,
      MAX(o.order_date) AS last_order_date
    FROM orders o
    JOIN order_items oi ON oi.order_id = o.order_id
    JOIN menu_items mi ON mi.menu_item_id = oi.menu_item_id
    JOIN candidate c ON c.menu_version_id = mi.menu_version_id
    WHERE o.status = 'ACTIVE'
      AND c.effective_date <= o.order_date
      AND (oi.legacy_item_id IS NULL OR oi.legacy_item_id = mi.legacy_item_id)
      AND NOT EXISTS (
        SELECT 1 FROM vendor_order_vendor_attributions attributed
        WHERE attributed.order_id = o.order_id
      )
  `).bind(...params).first();
  return {
    success: true,
    vendor: { id: vendor.vendor_id, name: vendor.name },
    menuVersionNames: vendorNames,
    versionCount: Number(versions?.version_count || 0),
    firstVersionDate: versions?.first_date || null,
    lastVersionDate: versions?.last_date || null,
    orderCount: Number(orders?.order_count || 0),
    dayCount: Number(orders?.day_count || 0),
    firstOrderDate: orders?.first_order_date || null,
    lastOrderDate: orders?.last_order_date || null
  };
};

export const applyVendorHistoryImport = async (database, identity, vendor, expectedVersions, now = new Date()) => {
  const preview = await previewVendorHistoryImport(database, vendor, now);
  if (!Number.isSafeInteger(expectedVersions) || expectedVersions !== preview.versionCount) {
    throw conflict('VENDOR_HISTORY_PREVIEW_STALE');
  }
  if (preview.versionCount === 0) return { ...preview, importedVersions: 0 };
  const { vendorNames, params } = candidateParams(vendor, now);
  const reviewedAt = now.toISOString();
  const insert = prepareStatement(database, `
    INSERT INTO vendor_menu_version_mapping_events (
      event_id, menu_version_id, revision, vendor_id, effective_date,
      mapping_status, evidence_kind, reviewed_by_user_id, reviewed_at
    )
    SELECT 'vendor_mapping_' || lower(hex(randomblob(16))), candidate.menu_version_id, 1, ?,
      candidate.effective_date, 'VERIFIED', 'MENU_VERSION_ID_EFFECTIVE_DATE', ?, ?
    FROM (${candidateVersionsSql(vendorNames)}) candidate
  `, [vendor.vendor_id, identity.actor.userId, reviewedAt, ...params]);
  const audit = auditStatement(database, {
    actorUserId: identity.actor.userId,
    actorAuthMode: identity.actor.authMode,
    action: 'VENDOR_HISTORY_MAPPINGS_VERIFIED',
    metadata: {
      vendorId: vendor.vendor_id,
      versionCount: preview.versionCount,
      firstVersionDate: preview.firstVersionDate,
      lastVersionDate: preview.lastVersionDate
    },
    occurredAt: reviewedAt
  });
  await runMutationBatch(database, [insert, audit]);
  return { ...preview, importedVersions: preview.versionCount };
};

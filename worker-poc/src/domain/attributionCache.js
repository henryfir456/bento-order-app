import { resolveClock } from '../db/transactions.js';

// vendor_order_vendor_attributions reads a cache of the expensive legacy
// attribution (see migration 0025). Inserting a reviewed mapping or line
// identity marks the cache stale; the next vendor read rebuilds it once.
const STATE_SQL = `
  SELECT source_version, built_version
  FROM vendor_attribution_cache_state WHERE state_id = 1
`;

export const ensureAttributionCache = async (database, now = new Date()) => {
  const state = await database.prepare(STATE_SQL).first();
  if (!state || Number(state.source_version) === Number(state.built_version)) return false;
  const version = Number(state.source_version);
  await database.batch([
    database.prepare('DELETE FROM vendor_legacy_attribution_cache'),
    database.prepare(`
      INSERT OR IGNORE INTO vendor_legacy_attribution_cache (order_id, vendor_id, order_date)
      SELECT live.order_id, live.vendor_id, o.order_date
      FROM vendor_order_vendor_attributions_live live
      JOIN orders o ON o.order_id = live.order_id
      WHERE NOT EXISTS (
        SELECT 1 FROM canonical_order_vendor_assignments direct
        WHERE direct.order_id = live.order_id
      )
    `),
    database.prepare(`
      UPDATE vendor_attribution_cache_state
      SET built_version = ?, built_at = ?
      WHERE state_id = 1 AND built_version < ?
    `).bind(version, resolveClock(now).toISOString(), version)
  ]);
  return true;
};

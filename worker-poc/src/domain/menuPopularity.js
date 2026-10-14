import { getTaipeiDate } from './deadlines.js';
import { NORMALIZED_MENU_START_DATE } from './menuItemChanges.js';
import { normalizeMenuVendor } from './menuVendors.js';

const POPULARITY_VENDOR = '蔡老師';
const PINNED_CODE = 'E';

const dateDaysAgo = (today, days) => {
  const date = new Date(`${today}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
};

const rowsFrom = (value) => Array.isArray(value?.results) ? value.results : (Array.isArray(value) ? value : []);

const menuCode = (item) => {
  const code = String(item?.legacy_item_id || '').trim().toUpperCase();
  return /^[A-Z][A-Z0-9]*$/.test(code) ? code : null;
};

// Only match canonical current-menu codes. Synthetic fee/refund rows
// (e.g. FR1, revert1) never affect popularity even if quantity is enormous.
export const rankCaiTeacherMenu = async (database, menu, {
  vendor,
  now = new Date()
} = {}) => {
  if (normalizeMenuVendor(vendor) !== POPULARITY_VENDOR || menu.length < 2) return menu;
  const codeByIndex = menu.map(menuCode);
  const eligibleCodes = new Set(codeByIndex.filter((code, index) =>
    code && code !== 'FR' && Number(menu[index].price) > 0));
  const today = getTaipeiDate(now);
  const since90 = dateDaysAgo(today, 89) < NORMALIZED_MENU_START_DATE
    ? NORMALIZED_MENU_START_DATE : dateDaysAgo(today, 89);
  const since30 = dateDaysAgo(today, 29);
  const response = await database.prepare(`
    SELECT i.legacy_item_id, i.item_name_snapshot, o.order_date, SUM(i.quantity) AS quantity
    FROM order_items i
    JOIN orders o ON o.order_id = i.order_id
    WHERE o.vendor = ?
      AND o.status IN ('ACTIVE', 'COMPLETED')
      AND o.order_date BETWEEN ? AND ?
      AND i.quantity > 0
    GROUP BY i.legacy_item_id, i.item_name_snapshot, o.order_date
  `).bind(POPULARITY_VENDOR, since90, today).all();
  const scores = new Map();
  for (const row of rowsFrom(response)) {
    // Post-migration canonical codes are shared by BASE/HALF variants.
    // Historical aliases (C95, CH, S_half etc.) are deliberately ignored.
    const code = String(row.legacy_item_id || '').trim().toUpperCase();
    if (!code || !eligibleCodes.has(code)) continue;
    const quantity = Number(row.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) continue;
    const previous = scores.get(code) || { recent: 0, long: 0 };
    previous.long += quantity;
    if (row.order_date >= since30) previous.recent += quantity;
    scores.set(code, previous);
  }
  const max30 = Math.max(0, ...[...scores.values()].map((v) => v.recent));
  const max90 = Math.max(0, ...[...scores.values()].map((v) => v.long));
  const weighted = (code) => {
    const data = scores.get(code);
    if (!data) return 0;
    return (max30 ? 0.7 * data.recent / max30 : 0)
      + (max90 ? 0.3 * data.long / max90 : 0);
  };
  const originalOrder = new Map();
  codeByIndex.forEach((code, index) => {
    if (code && !originalOrder.has(code)) originalOrder.set(code, index);
  });
  const codeOrder = [...new Set(codeByIndex.filter(Boolean))].sort((a, b) => {
    if (a === 'FR' || b === 'FR') return a === 'FR' ? 1 : -1;
    if (a === PINNED_CODE || b === PINNED_CODE) return a === PINNED_CODE ? -1 : 1;
    return weighted(b) - weighted(a) || originalOrder.get(a) - originalOrder.get(b);
  });
  const ranks = new Map(codeOrder.map((code, index) => [code, index]));
  return menu.map((item, index) => ({
    ...item,
    popularity_rank: codeByIndex[index] ? ranks.get(codeByIndex[index]) : codeOrder.length + index,
    popularity_score: codeByIndex[index] ? Math.round(weighted(codeByIndex[index]) * 1000) / 1000 : 0
  })).sort((a, b) => a.popularity_rank - b.popularity_rank);
};

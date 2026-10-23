export const currency = (value) => `${Number(value || 0).toLocaleString('zh-TW')} 元`;
export const dayStatusLabel = (day) => {
  if (day.source === 'HISTORY') return '歷史已結清';
  if (day.source === 'SNAPSHOT') return `已截止・快照 v${day.revision}`;
  if (day.source === 'MOCK') return day.cutoffPassed ? '已截止（Mock）' : '未截止・暫估（Mock）';
  return day.cutoffPassed ? '已截止' : '未截止・暫估';
};
export const formatTaipeiTime = (value) => (value
  ? new Date(value).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })
  : '未設定');
// Vendors read dish names, not variant codes: BASE is the plain dish, and the
// other variants get their Chinese label unless the name already says it.
const VARIANT_LABELS = { BASE: '', HALF: '半飯', PLUS: '加量' };
export const vendorItemLabel = (item) => {
  const name = item?.name || '';
  const key = String(item?.variantKey || '').trim();
  const label = Object.hasOwn(VARIANT_LABELS, key.toUpperCase()) ? VARIANT_LABELS[key.toUpperCase()] : key;
  return label && !name.includes(label) ? `${name}（${label}）` : name;
};

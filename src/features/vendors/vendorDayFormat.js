export const currency = (value) => `${Number(value || 0).toLocaleString('zh-TW')} 元`;
export const dayStatusLabel = (day) => {
  if (day.source === 'HISTORY') return '歷史已結清';
  if (day.source === 'SNAPSHOT') return `已截止・快照 v${day.revision}`;
  if (day.source === 'MOCK') return day.cutoffPassed ? '已截止（Mock）' : '未截止・暫估（Mock）';
  return day.cutoffPassed ? '已截止' : '未截止・暫估';
};
// BASE is the plain dish, so only non-default variants get a Chinese suffix.
const VARIANT_LABELS = { BASE: '', HALF: '半飯', PLUS: '加量' };
export const itemLabel = (item) => {
  const key = item.variantKey || '';
  const suffix = key in VARIANT_LABELS ? VARIANT_LABELS[key] : key;
  return suffix ? `${item.name}（${suffix}）` : item.name;
};
export const formatTaipeiTime = (value) => (value
  ? new Date(value).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })
  : '未設定');

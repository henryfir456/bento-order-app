export const currency = (value) => `${Number(value || 0).toLocaleString('zh-TW')} 元`;
export const dayStatusLabel = (day) => {
  if (day.source === 'SNAPSHOT') return `已截止・快照 v${day.revision}`;
  if (day.source === 'MOCK') return day.cutoffPassed ? '已截止（Mock）' : '未截止・暫估（Mock）';
  return day.cutoffPassed ? '已截止' : '未截止・暫估';
};
export const formatTaipeiTime = (value) => (value
  ? new Date(value).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })
  : '未設定');

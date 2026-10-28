const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_LABELS = ['上週', '本週', '下週'];

const toKey = (utcMs) => new Date(utcMs).toISOString().slice(0, 10);

// Three Monday-Friday rows (last, this, next week) around a Taipei date key.
// On Saturday/Sunday "this week" is the coming one, since nothing can be ordered on the weekend.
export const buildRollingWeeks = (todayKey) => {
  const [year, month, day] = String(todayKey).split('-').map(Number);
  const today = Date.UTC(year, month - 1, day);
  const weekday = new Date(today).getUTCDay();
  const mondayOffset = weekday === 0 ? 1 : weekday === 6 ? 2 : 1 - weekday;
  const thisMonday = today + mondayOffset * DAY_MS;
  return WEEK_LABELS.map((label, index) => {
    const monday = thisMonday + (index - 1) * 7 * DAY_MS;
    return {
      label,
      days: Array.from({ length: 5 }, (_, offset) => {
        const key = toKey(monday + offset * DAY_MS);
        return { key, day: Number(key.slice(8)), month: Number(key.slice(5, 7)) };
      })
    };
  });
};

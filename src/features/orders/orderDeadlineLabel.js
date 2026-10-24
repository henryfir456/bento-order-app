const TAIPEI = 'Asia/Taipei';
const dateKey = (date) => new Intl.DateTimeFormat('en-CA', { timeZone: TAIPEI, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
const clock = (date) => new Intl.DateTimeFormat('en-GB', { timeZone: TAIPEI, hour: '2-digit', minute: '2-digit', hour12: false }).format(date);

// Returns { text, remainingMs } for an open order day, or null when the deadline is unknown or already passed.
export const formatOrderDeadline = (deadlineIso, now = new Date()) => {
  const deadline = new Date(deadlineIso);
  if (!deadlineIso || Number.isNaN(deadline.getTime())) return null;
  const remainingMs = deadline.getTime() - now.getTime();
  if (remainingMs <= 0) return null;

  const dayDiff = Math.round((Date.parse(`${dateKey(deadline)}T00:00:00Z`) - Date.parse(`${dateKey(now)}T00:00:00Z`)) / 86400000);
  const [, month, day] = dateKey(deadline).split('-');
  const dayLabel = dayDiff === 0 ? '今天' : dayDiff === 1 ? '明天' : `${Number(month)}/${Number(day)}`;

  const totalMinutes = Math.ceil(remainingMs / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const remaining = days > 0 ? `${days} 天 ${hours} 小時`
    : hours > 0 ? `${hours} 小時 ${minutes} 分`
    : `${minutes} 分鐘`;
  return { text: `${dayLabel} ${clock(deadline)} 截止・剩 ${remaining}`, remainingMs };
};

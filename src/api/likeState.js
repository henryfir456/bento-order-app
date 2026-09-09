export const normalizeWorkerLikeResponse = (data) => {
  if (data?.success !== true || typeof data.isLiked !== 'boolean') return null;
  if (!Number.isSafeInteger(data.totalLikes) || data.totalLikes < 0) return null;
  return { isLiked: data.isLiked, likeCount: data.totalLikes };
};

export const restoreCalendarEvent = (events, dateStr, previousEvent) => {
  const next = { ...events };
  if (previousEvent === undefined) {
    delete next[dateStr];
  } else {
    next[dateStr] = previousEvent;
  }
  return next;
};

export const normalizeDeferredLikes = (rawLikes) => {
  if (!rawLikes || typeof rawLikes !== 'object' || Array.isArray(rawLikes)) return null;

  return Object.entries(rawLikes).reduce((result, [dateStr, state]) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return result;

    const likeCount = Number(state?.likeCount);
    if (!Number.isFinite(likeCount) || likeCount < 0 || typeof state?.isUserLiked !== 'boolean') {
      return result;
    }

    result[dateStr] = {
      likeCount: Math.floor(likeCount),
      isUserLiked: state.isUserLiked,
      calendarEvent: state.calendarEvent && typeof state.calendarEvent === 'object'
        ? {
          order_date: String(state.calendarEvent.order_date || '').trim(),
          vendor: String(state.calendarEvent.vendor || ''),
          mode: String(state.calendarEvent.mode || ''),
          deadline: String(state.calendarEvent.deadline || ''),
          isExpired: Boolean(state.calendarEvent.isExpired),
          lunarLabel: state.calendarEvent.lunarLabel == null
            ? null
            : String(state.calendarEvent.lunarLabel)
        }
        : null
    };
    return result;
  }, {});
};

export const normalizeDeferredAnnouncements = (rawAnnouncements) => {
  if (!Array.isArray(rawAnnouncements)) return null;

  return rawAnnouncements.reduce((result, announcement) => {
    const id = String(announcement?.id || '').trim();
    const title = String(announcement?.title || '').trim();
    const content = String(announcement?.content || '');
    const startDate = String(announcement?.start_date || '').trim();
    const endDate = String(announcement?.end_date || '').trim();

    if (!id || !title || !content.trim()) return result;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      return result;
    }

    result.push({
      id,
      title,
      content,
      start_date: startDate,
      end_date: endDate
    });
    return result;
  }, []);
};

export const mergeDeferredLikes = (events, likes) => Object.entries(likes).reduce((result, [dateStr, likeState]) => {
  const { calendarEvent, ...likeStateWithoutEvent } = likeState;
  if (!result[dateStr] && calendarEvent?.order_date === dateStr && calendarEvent.mode) {
    result[dateStr] = { ...calendarEvent, ...likeStateWithoutEvent };
  } else if (result[dateStr]) {
    result[dateStr] = { ...result[dateStr], ...likeStateWithoutEvent };
  }
  return result;
}, { ...events });

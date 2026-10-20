export const shouldShowAnnouncementEmptyState = ({
  loading = false,
  error = '',
  announcements = []
} = {}) => !loading
  && !error
  && Array.isArray(announcements)
  && announcements.length === 0;

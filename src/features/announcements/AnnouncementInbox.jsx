import { useState } from 'react';
import Modal from '../../components/Modal';
import AnnouncementContent from './AnnouncementContent';
import { shouldShowAnnouncementEmptyState } from './announcementInboxViewState';

export default function AnnouncementInbox({
  open,
  announcements = [],
  unreadCount = 0,
  loading = false,
  error = '',
  notifications = [],
  announcementsAvailable = true,
  onRetry,
  onClose,
  onRead,
  onReadNotification
}) {
  const [selectedId, setSelectedId] = useState('');
  const selected = announcements.find((announcement) => announcement.id === selectedId) || null;
  const showEmptyState = !announcementsAvailable
    ? notifications.length === 0
    : shouldShowAnnouncementEmptyState({ loading, error, announcements }) && notifications.length === 0;
  const unreadNotifications = notifications.filter((item) => !item.readAt).length;

  const formatTime = (value) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const close = () => {
    setSelectedId('');
    onClose();
  };

  return (
    <Modal
      open={open}
      title={selected ? '公告詳情' : '通知'}
      onClose={close}
      className="max-w-lg"
    >
      {selected ? (
        <div className="space-y-4">
          <button
            type="button"
            onClick={() => setSelectedId('')}
            className="rounded-lg px-2 py-1 text-sm font-semibold text-emerald-800 hover:bg-emerald-50 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          >
            ← 返回公告列表
          </button>
          <AnnouncementContent announcement={selected} />
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-gray-500">未讀 {unreadCount + unreadNotifications} 則</p>
          {notifications.length > 0 && (
            <ul className="divide-y divide-gray-100 rounded-xl border border-emerald-100" aria-label="系統通知">
              {notifications.map((notification) => (
                <li key={notification.id}>
                  <button
                    type="button"
                    onClick={() => { if (!notification.readAt) onReadNotification?.(notification); }}
                    className="flex min-h-14 w-full items-start gap-3 px-3 py-3 text-left hover:bg-emerald-50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-emerald-500"
                  >
                    {!notification.readAt && <span aria-hidden="true" className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-emerald-700" />}
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold text-gray-800">{notification.title}</span>
                      <span className="block break-words text-sm text-gray-600">{notification.body}</span>
                      <span className="block text-xs text-gray-400">{formatTime(notification.createdAt)}</span>
                    </span>
                    {!notification.readAt && <span className="sr-only">未讀</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {error && announcementsAvailable && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800" role="alert">
              <p>{error}</p>
              <button type="button" onClick={onRetry} className="mt-2 font-bold underline">重試</button>
            </div>
          )}
          {!announcementsAvailable ? (
            notifications.length === 0 ? <p className="rounded-xl bg-gray-50 p-5 text-center text-sm text-gray-500">尚無通知</p> : null
          ) : loading && announcements.length === 0 ? (
            <div role="status" className="py-6 text-center text-sm text-gray-500">公告載入中…</div>
          ) : showEmptyState ? (
            <p className="rounded-xl bg-gray-50 p-5 text-center text-sm text-gray-500">尚無公告或通知</p>
          ) : announcements.length > 0 ? (
            <ul className="divide-y divide-gray-100" aria-label="公告列表">
              {announcements.map((announcement) => (
                <li key={announcement.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedId(announcement.id);
                      if (!announcement.readAt) onRead?.(announcement);
                    }}
                    className="flex min-h-14 w-full items-center gap-3 py-3 text-left hover:bg-emerald-50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-emerald-500"
                  >
                    {!announcement.readAt && <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-emerald-700" />}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold text-gray-800">{announcement.title}</span>
                      <span className="block text-xs text-gray-500">{String(announcement.start_date || '').replace(/-/g, '/')}</span>
                    </span>
                    {!announcement.readAt && <span className="sr-only">未讀</span>}
                    <span aria-hidden="true" className="text-gray-400">›</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
    </Modal>
  );
}

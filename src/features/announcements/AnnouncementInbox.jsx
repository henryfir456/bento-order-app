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
  onRetry,
  onClose,
  onRead
}) {
  const [selectedId, setSelectedId] = useState('');
  const selected = announcements.find((announcement) => announcement.id === selectedId) || null;
  const showEmptyState = shouldShowAnnouncementEmptyState({
    loading,
    error,
    announcements
  });

  const close = () => {
    setSelectedId('');
    onClose();
  };

  return (
    <Modal
      open={open}
      title={selected ? '公告詳情' : '公告通知'}
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
          <p className="text-xs text-gray-500">未讀 {unreadCount} 則</p>
          {error && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800" role="alert">
              <p>{error}</p>
              <button type="button" onClick={onRetry} className="mt-2 font-bold underline">重新載入公告</button>
            </div>
          )}
          {loading && announcements.length === 0 ? (
            <div role="status" className="py-6 text-center text-sm text-gray-500">公告載入中…</div>
          ) : showEmptyState ? (
            <p className="rounded-xl bg-gray-50 p-5 text-center text-sm text-gray-500">目前沒有公告</p>
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

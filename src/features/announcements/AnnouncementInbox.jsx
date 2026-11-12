import { useState } from 'react';
import Modal from '../../components/Modal';
import AnnouncementContent from './AnnouncementContent';
import { shouldShowAnnouncementEmptyState } from './announcementInboxViewState';
import LoadingNote from '../../components/ui/LoadingNote';

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
  const [tab, setTab] = useState('');
  const unreadNotifications = notifications.filter((item) => !item.readAt).length;
  // Opens on 通知 unless only 公告 has unread items.
  const activeTab = tab || (unreadNotifications === 0 && unreadCount > 0 ? 'announcements' : 'notifications');

  const formatTime = (value) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const close = () => {
    setSelectedId('');
    setTab('');
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
          <div role="tablist" aria-label="通知與公告" className="flex gap-2 border-b border-gray-100">
            {[
              { key: 'notifications', label: '通知', count: unreadNotifications },
              { key: 'announcements', label: '公告', count: unreadCount }
            ].map((item) => (
              <button
                key={item.key}
                type="button"
                role="tab"
                id={`inbox-tab-${item.key}`}
                aria-selected={activeTab === item.key}
                aria-controls="inbox-tabpanel"
                onClick={() => setTab(item.key)}
                className={`-mb-px flex min-h-11 items-center gap-1.5 border-b-2 px-3 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-inset focus:ring-emerald-500 ${activeTab === item.key ? 'border-emerald-700 text-emerald-800' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
              >
                {item.label}
                {item.count > 0 && (
                  <span className="min-w-5 rounded-full bg-rose-600 px-1.5 text-center text-xs font-bold leading-5 text-white">
                    {item.count > 99 ? '99+' : item.count}
                    <span className="sr-only"> 則未讀</span>
                  </span>
                )}
              </button>
            ))}
          </div>
          <div role="tabpanel" id="inbox-tabpanel" aria-labelledby={`inbox-tab-${activeTab}`} className="max-h-[60vh] space-y-3 overflow-y-auto">
            {activeTab === 'notifications' ? (
              <>
                <p className="text-xs text-gray-500">系統通知只保留最近 14 天</p>
                {notifications.length === 0 ? (
                  <p className="rounded-xl bg-gray-50 p-5 text-center text-sm text-gray-500">尚無通知</p>
                ) : (
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
                            <span className="block whitespace-pre-line break-words text-sm text-gray-600">{notification.body}</span>
                            <span className="block text-xs text-gray-400">{formatTime(notification.createdAt)}</span>
                          </span>
                          {!notification.readAt && <span className="sr-only">未讀</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <>
                {error && announcementsAvailable && (
                  <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800" role="alert">
                    <p>{error}</p>
                    <button type="button" onClick={onRetry} className="mt-2 font-bold underline">重試</button>
                  </div>
                )}
                {!announcementsAvailable ? (
                  <p className="rounded-xl bg-gray-50 p-5 text-center text-sm text-gray-500">尚無公告</p>
                ) : loading && announcements.length === 0 ? (
                  <LoadingNote label="公告" />
                ) : shouldShowAnnouncementEmptyState({ loading, error, announcements }) ? (
                  <p className="rounded-xl bg-gray-50 p-5 text-center text-sm text-gray-500">尚無公告</p>
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
              </>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

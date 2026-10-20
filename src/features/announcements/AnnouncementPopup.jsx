import { useState } from 'react';
import Modal from '../../components/Modal';
import AnnouncementContent from './AnnouncementContent';

export default function AnnouncementPopup({
  announcement,
  loading = false,
  error = '',
  onClose,
  onDismiss
}) {
  const [dontShowAgain, setDontShowAgain] = useState(false);
  if (!announcement) return null;
  return (
    <Modal
      open={Boolean(announcement)}
      title="最新公告"
      onClose={onClose}
      className="max-w-lg"
    >
      <div className="space-y-4">
        <AnnouncementContent announcement={announcement} />
        <label className="flex min-h-11 items-center gap-2 rounded-xl bg-gray-50 px-3 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={dontShowAgain}
            onChange={(event) => setDontShowAgain(event.target.checked)}
            className="h-4 w-4 accent-[#2C4A3E]"
          />
          不再自動顯示此公告
        </label>
        {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="min-h-11 rounded-xl border border-gray-200 px-4 text-sm font-semibold text-gray-700 disabled:opacity-60"
          >
            稍後再看
          </button>
          {dontShowAgain && (
            <button
              type="button"
              onClick={onDismiss}
              disabled={loading}
              className="min-h-11 rounded-xl bg-[#2C4A3E] px-4 text-sm font-bold text-white disabled:opacity-60"
            >
              {loading ? '儲存中…' : '確認不再顯示'}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}

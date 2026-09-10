import { useState } from 'react';

const EMPTY_FORM = Object.freeze({
  title: '',
  content: '',
  start_date: '',
  end_date: '',
  enabled: true
});

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const formFromAnnouncement = (announcement) => ({
  title: announcement?.title || '',
  content: announcement?.content || '',
  start_date: announcement?.start_date || '',
  end_date: announcement?.end_date || '',
  enabled: announcement?.enabled !== false
});

const validateForm = (form) => {
  if (!form.title.trim()) return '請輸入公告標題。';
  if (!form.content.trim()) return '請輸入公告內容。';
  if (!DATE_PATTERN.test(form.start_date) || !DATE_PATTERN.test(form.end_date)) {
    return '請輸入有效的公告日期。';
  }
  if (form.end_date < form.start_date) return '結束日期不可早於開始日期。';
  return '';
};

const errorMessage = (error) => {
  if (error?.code) return `公告操作失敗（${error.code}）。`;
  if (error?.message) return error.message;
  return '公告操作失敗，請稍後再試。';
};

export default function AnnouncementManagement({
  announcements = [],
  loading = false,
  error = '',
  isViewAsMode = false,
  onRefresh = async () => {},
  onCreate = async () => {},
  onUpdate = async () => {},
  onDelete = async () => {}
}) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState('');
  const [actionError, setActionError] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setEditingId('');
    setActionError('');
  };

  const handleEdit = (announcement) => {
    if (isViewAsMode || actionLoading) return;
    setForm(formFromAnnouncement(announcement));
    setEditingId(announcement.id);
    setActionError('');
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (isViewAsMode || actionLoading) return;

    const validationError = validateForm(form);
    if (validationError) {
      setActionError(validationError);
      return;
    }

    const payload = {
      title: form.title.trim(),
      content: form.content.trim(),
      start_date: form.start_date,
      end_date: form.end_date,
      enabled: form.enabled
    };
    setActionError('');
    setActionLoading(true);
    try {
      if (editingId) {
        await onUpdate(editingId, payload);
      } else {
        await onCreate(payload);
      }
      resetForm();
      await onRefresh();
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setActionLoading(false);
    }
  };

  const handleToggle = async (announcement) => {
    if (isViewAsMode || actionLoading) return;
    setActionError('');
    setActionLoading(true);
    try {
      await onUpdate(announcement.id, { enabled: !announcement.enabled });
      await onRefresh();
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setActionLoading(false);
    }
  };

  const handleDelete = async (announcement) => {
    if (isViewAsMode || actionLoading) return;
    if (typeof window === 'undefined' || !window.confirm(`確定刪除公告「${announcement.title}」？`)) return;

    setActionError('');
    setActionLoading(true);
    try {
      await onDelete(announcement.id);
      if (editingId === announcement.id) resetForm();
      await onRefresh();
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-white p-4 rounded-2xl shadow-sm border border-emerald-900/10 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-bold text-base text-[#2C4A3E]">📢 公告管理</h3>
            <p className="text-xs text-gray-500">僅管理員可新增、編輯、啟用或刪除公告。</p>
          </div>
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading || actionLoading || isViewAsMode}
            className="rounded-xl border border-emerald-200 px-3 py-2 text-xs font-bold text-emerald-800 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            重新整理
          </button>
        </div>
      </div>

      {(error || actionError) && (
        <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          {actionError || error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-3 rounded-2xl border border-emerald-900/10 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <h4 className="font-bold text-[#2C4A3E]">{editingId ? '編輯公告' : '新增公告'}</h4>
          {editingId && (
            <button
              type="button"
              onClick={resetForm}
              disabled={actionLoading}
              className="text-xs font-bold text-gray-500 underline disabled:opacity-50"
            >
              取消編輯
            </button>
          )}
        </div>

        <label className="block space-y-1 text-xs font-bold text-gray-600" htmlFor="announcement-title">
          標題
          <input
            id="announcement-title"
            type="text"
            value={form.title}
            onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
            disabled={isViewAsMode || actionLoading}
            className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-normal focus:outline-emerald-600 disabled:bg-gray-100"
          />
        </label>

        <label className="block space-y-1 text-xs font-bold text-gray-600" htmlFor="announcement-content">
          內容
          <textarea
            id="announcement-content"
            value={form.content}
            onChange={(event) => setForm((current) => ({ ...current, content: event.target.value }))}
            disabled={isViewAsMode || actionLoading}
            rows="4"
            className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-normal focus:outline-emerald-600 disabled:bg-gray-100"
          />
        </label>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block space-y-1 text-xs font-bold text-gray-600" htmlFor="announcement-start-date">
            開始日期
            <input
              id="announcement-start-date"
              type="date"
              value={form.start_date}
              onChange={(event) => setForm((current) => ({ ...current, start_date: event.target.value }))}
              disabled={isViewAsMode || actionLoading}
              className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-normal focus:outline-emerald-600 disabled:bg-gray-100"
            />
          </label>
          <label className="block space-y-1 text-xs font-bold text-gray-600" htmlFor="announcement-end-date">
            結束日期
            <input
              id="announcement-end-date"
              type="date"
              value={form.end_date}
              onChange={(event) => setForm((current) => ({ ...current, end_date: event.target.value }))}
              disabled={isViewAsMode || actionLoading}
              className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-normal focus:outline-emerald-600 disabled:bg-gray-100"
            />
          </label>
        </div>

        <label className="flex items-center gap-2 text-xs font-bold text-gray-600" htmlFor="announcement-enabled">
          <input
            id="announcement-enabled"
            type="checkbox"
            checked={form.enabled}
            onChange={(event) => setForm((current) => ({ ...current, enabled: event.target.checked }))}
            disabled={isViewAsMode || actionLoading}
          />
          啟用公告
        </label>

        <button
          type="submit"
          disabled={isViewAsMode || actionLoading}
          className="w-full rounded-xl bg-[#2C4A3E] px-4 py-2.5 text-sm font-bold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-gray-300"
        >
          {actionLoading ? '處理中...' : editingId ? '儲存公告' : '新增公告'}
        </button>
      </form>

      <div className="space-y-3">
        {loading ? (
          <div className="rounded-2xl border border-emerald-900/10 bg-white p-6 text-center text-sm text-emerald-800 animate-pulse">
            讀取公告中...
          </div>
        ) : announcements.length === 0 ? (
          <div className="rounded-2xl border border-emerald-900/10 bg-white p-6 text-center text-sm text-gray-400">
            目前沒有公告
          </div>
        ) : announcements.map((announcement) => (
          <article key={announcement.id} className="rounded-2xl border border-emerald-900/10 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <h4 className="break-words font-bold text-[#2C4A3E]">{announcement.title}</h4>
                <p className="text-xs text-gray-500">{announcement.start_date} ～ {announcement.end_date}</p>
              </div>
              <span className={`rounded-full px-2 py-1 text-xs font-bold ${announcement.enabled ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-500'}`}>
                {announcement.enabled ? '啟用' : '停用'}
              </span>
            </div>
            <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-gray-600">{announcement.content}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => handleEdit(announcement)}
                disabled={isViewAsMode || actionLoading}
                className="rounded-xl bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                編輯
              </button>
              <button
                type="button"
                onClick={() => handleToggle(announcement)}
                disabled={isViewAsMode || actionLoading}
                className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {announcement.enabled ? '停用' : '啟用'}
              </button>
              <button
                type="button"
                onClick={() => handleDelete(announcement)}
                disabled={isViewAsMode || actionLoading}
                className="rounded-xl bg-rose-50 px-3 py-2 text-xs font-bold text-rose-800 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                刪除
              </button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}


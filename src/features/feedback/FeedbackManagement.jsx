import { useCallback, useEffect, useState } from 'react';
import Swal from '../../lib/swal';
import LoadingNote from '../../components/ui/LoadingNote';
import ErrorNotice from '../../components/ui/ErrorNotice';
import { RatingText } from './FeedbackPage';
import {
  CATEGORY_LABELS, STATUS_LABELS, STATUS_STYLES,
  feedbackErrorMessage, formatFeedbackTime, parsedResult
} from './feedbackModel';

const FILTERS = [['', '全部'], ['NEW', '未處理'], ['IN_PROGRESS', '處理中'], ['DONE', '已處理']];

// Admin view: read feedback, mark it handled and leave a short reply note.
export default function FeedbackManagement({ api }) {
  const [status, setStatus] = useState('NEW');
  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const result = await parsedResult(api.listAdminFeedback({ status }));
      setItems(result?.feedback || []);
      setSummary(result?.summary || null);
    } catch (err) {
      setLoadError(feedbackErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [api, status]);

  useEffect(() => { void reload(); }, [reload]);

  const update = async (item, nextStatus) => {
    const { isConfirmed, value } = await Swal.fire({
      title: `標記為「${STATUS_LABELS[nextStatus]}」`,
      input: 'text',
      inputValue: item.adminNote || '',
      inputPlaceholder: '給提交者的回覆（選填，對方看得到）',
      inputAttributes: { maxlength: 500 },
      showCancelButton: true,
      confirmButtonText: '確定',
      cancelButtonText: '取消'
    });
    if (!isConfirmed) return;
    setBusy(true);
    setError('');
    try {
      await parsedResult(api.updateFeedbackStatus({ feedbackId: item.feedbackId, status: nextStatus, note: value || '' }));
      await reload();
    } catch (err) {
      setError(feedbackErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="意見反饋管理" className="space-y-3">
      <h2 className="text-xl font-bold text-[#2C4A3E]">意見反饋</h2>
      <p className="text-xs text-gray-500">只有管理員和提交者本人看得到；匿名的意見不顯示姓名。</p>
      {summary && (
        <p className="text-sm text-slate-700">
          共 {summary.total} 則，未處理 {summary.newCount} 則
          {summary.averageRating !== null && `，平均 ${summary.averageRating} 顆星（${summary.ratingCount} 則評分）`}
        </p>
      )}
      <div role="group" aria-label="狀態篩選" className="flex flex-wrap gap-2">
        {FILTERS.map(([key, label]) => (
          <button key={key} type="button" aria-pressed={status === key} onClick={() => setStatus(key)}
            className={`min-h-11 rounded-lg px-4 text-sm font-bold ${status === key ? 'bg-[#2C4A3E] text-white' : 'border border-slate-300 bg-white text-slate-700'}`}>
            {label}
          </button>
        ))}
      </div>
      {error && <p role="alert" className="text-sm font-semibold text-red-700">{error}</p>}
      {loading && <LoadingNote label="意見" />}
      {loadError && <ErrorNotice message={loadError} onRetry={reload} />}
      {!loading && !loadError && !items.length && <p className="text-sm text-slate-500">尚無意見。</p>}
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item.feedbackId} className="space-y-2 rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-bold text-[#2C4A3E]">
                {CATEGORY_LABELS[item.category] || item.category}{item.targetName ? `・${item.targetName}` : ''}
              </span>
              <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${STATUS_STYLES[item.status] || ''}`}>
                {STATUS_LABELS[item.status] || item.status}
              </span>
            </div>
            <RatingText rating={item.rating} />
            <p className="whitespace-pre-wrap break-words text-sm text-slate-700">{item.message}</p>
            <p className="text-xs text-slate-500">
              {item.isAnonymous ? '匿名' : `${item.submitterName || '未知'}${item.submitterRole ? `（${item.submitterRole === 'Vendor' ? '廠商' : '員工'}）` : ''}`}
              ・{formatFeedbackTime(item.createdAt)}
            </p>
            {item.adminNote && <p className="rounded-lg bg-slate-50 p-2 text-sm text-slate-600">回覆：{item.adminNote}</p>}
            <div className="flex gap-2">
              {item.status !== 'IN_PROGRESS' && (
                <button type="button" disabled={busy} onClick={() => update(item, 'IN_PROGRESS')}
                  className="min-h-11 flex-1 rounded-lg border border-slate-300 bg-white font-bold text-slate-700 disabled:opacity-40">處理中</button>
              )}
              {item.status !== 'DONE' && (
                <button type="button" disabled={busy} onClick={() => update(item, 'DONE')}
                  className="min-h-11 flex-1 rounded-lg bg-[#2C4A3E] font-bold text-white disabled:opacity-40">已處理</button>
              )}
              {item.status !== 'NEW' && (
                <button type="button" disabled={busy} onClick={() => update(item, 'NEW')}
                  className="min-h-11 flex-1 rounded-lg border border-slate-300 bg-white font-bold text-slate-700 disabled:opacity-40">改回未處理</button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

import { useCallback, useEffect, useState } from 'react';
import Swal from '../../lib/swal';
import PageHeader from '../../components/ui/PageHeader';
import LoadingNote from '../../components/ui/LoadingNote';
import ErrorNotice from '../../components/ui/ErrorNotice';
import {
  CATEGORY_LABELS, STATUS_LABELS, STATUS_STYLES, VISIBILITY_NOTICE,
  feedbackErrorMessage, formatFeedbackTime, parsedResult
} from './feedbackModel';

function Stars({ value, onChange }) {
  return (
    <div role="group" aria-label="星等評價（選填）" className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" onClick={() => onChange(value === n ? 0 : n)}
          aria-label={`${n} 顆星`} aria-pressed={value >= n}
          className={`min-h-11 min-w-11 text-2xl ${value >= n ? 'text-amber-500' : 'text-slate-300'}`}>
          ★
        </button>
      ))}
      {value > 0 && <span className="text-xs text-slate-500">{value} / 5</span>}
    </div>
  );
}

export function RatingText({ rating }) {
  if (!rating) return null;
  return <span aria-label={`${rating} 顆星`} className="text-amber-500">{'★'.repeat(rating)}<span className="text-slate-300">{'★'.repeat(5 - rating)}</span></span>;
}

// Submit feedback and review your own past feedback. Visible only to the
// submitter and Admins; the notice below says so on screen.
export default function FeedbackPage({ api, onBack, backLabel = '返回' }) {
  const [category, setCategory] = useState('SYSTEM');
  const [targetName, setTargetName] = useState('');
  const [rating, setRating] = useState(0);
  const [message, setMessage] = useState('');
  const [anonymous, setAnonymous] = useState(false);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const result = await parsedResult(api.listMyFeedback());
      setItems(result?.feedback || []);
    } catch (err) {
      setLoadError(feedbackErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { void reload(); }, [reload]);

  const submit = async () => {
    if (!message.trim()) { setError(feedbackErrorMessage({ code: 'FEEDBACK_MESSAGE_REQUIRED' })); return; }
    setBusy(true);
    setError('');
    try {
      await parsedResult(api.createFeedback({
        category, targetName, rating: rating || null, message, isAnonymous: anonymous
      }));
      setMessage('');
      setTargetName('');
      setRating(0);
      await reload();
      await Swal.fire({ icon: 'success', title: '已送出，謝謝你的意見', timer: 1500, showConfirmButton: false });
    } catch (err) {
      setError(feedbackErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="意見反饋" className="space-y-3">
      <PageHeader title="意見反饋" hint={VISIBILITY_NOTICE} backLabel={backLabel} onBack={onBack} />
      <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
        <label className="block text-sm font-semibold text-slate-700">
          類別
          <select value={category} onChange={(e) => setCategory(e.target.value)}
            className="mt-1 block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3">
            {Object.entries(CATEGORY_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>
        {(category === 'MENU' || category === 'VENDOR') && (
          <label className="block text-sm font-semibold text-slate-700">
            {category === 'MENU' ? '便當名稱（選填）' : '店家名稱（選填）'}
            <input type="text" value={targetName} maxLength={60} onChange={(e) => setTargetName(e.target.value)}
              className="mt-1 block min-h-11 w-full rounded-lg border border-slate-300 px-3" />
          </label>
        )}
        <Stars value={rating} onChange={setRating} />
        <label className="block text-sm font-semibold text-slate-700">
          意見內容
          <textarea value={message} maxLength={1000} rows={5} onChange={(e) => setMessage(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2" />
          <span className="text-xs font-normal text-slate-500">{message.length} / 1000</span>
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} className="h-5 w-5" />
          匿名送出（管理員看不到我的姓名）
        </label>
        {error && <p role="alert" className="text-sm font-semibold text-red-700">{error}</p>}
        <button type="button" disabled={busy} onClick={submit}
          className="min-h-12 w-full rounded-xl bg-[#2C4A3E] font-bold text-white disabled:opacity-40">
          送出意見
        </button>
      </div>

      <h3 className="text-sm font-bold text-[#2C4A3E]">我送出的意見</h3>
      {loading && <LoadingNote label="意見紀錄" />}
      {loadError && <ErrorNotice message={loadError} onRetry={reload} />}
      {!loading && !loadError && !items.length && <p className="text-sm text-slate-500">尚無意見紀錄。</p>}
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item.feedbackId} className="space-y-1 rounded-xl border border-slate-200 bg-white p-4">
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
              {formatFeedbackTime(item.createdAt)}{item.isAnonymous ? '・匿名' : ''}
            </p>
            {item.adminNote && <p className="rounded-lg bg-slate-50 p-2 text-sm text-slate-600">管理員回覆：{item.adminNote}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}

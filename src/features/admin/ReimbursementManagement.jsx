import { useCallback, useEffect, useState } from 'react';
import Swal from '../../lib/swal';
import LoadingNote from '../../components/ui/LoadingNote';

const STATUS_LABELS = { PENDING: '待審核', APPROVED: '已同意', REJECTED: '已拒絕' };
const STATUS_STYLES = {
  PENDING: 'bg-amber-100 text-amber-800',
  APPROVED: 'bg-emerald-100 text-emerald-800',
  REJECTED: 'bg-slate-200 text-slate-700'
};

const ERROR_MESSAGES = {
  REIMBURSEMENT_ALREADY_REQUESTED: '這一天已經有待審或已同意的請款（全系統每天只能一筆）。',
  REIMBURSEMENT_NO_ELIGIBLE_ORDERS: '這一天沒有有效訂單。',
  REIMBURSEMENT_DATE_IN_FUTURE: '不能申請未來的日期。',
  REIMBURSEMENT_DATE_INVALID: '請選擇有效的日期。',
  REIMBURSEMENT_ALREADY_APPROVED: '這筆請款已經同意過了。',
  REIMBURSEMENT_ALREADY_REJECTED: '這筆請款已經拒絕過了。',
  REIMBURSEMENT_NOT_FOUND: '找不到這筆請款。'
};

const errorMessage = (error) => (
  ERROR_MESSAGES[error?.code] || (error?.code ? `操作失敗（${error.code}）。` : (error?.message || '操作失敗，請稍後再試。'))
);

const todayTaipei = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date());

function StatusBadge({ status }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${STATUS_STYLES[status] || ''}`}>
      {STATUS_LABELS[status] || status}
    </span>
  );
}

function OrderList({ orders = [] }) {
  if (!orders.length) return null;
  return (
    <ul className="space-y-1 text-sm text-slate-600">
      {orders.map((order) => (
        <li key={order.orderId} className="flex justify-between gap-2">
          <span>{order.name}{order.vendor ? `・${order.vendor}` : ''}</span>
          <span>${order.amount}</span>
        </li>
      ))}
    </ul>
  );
}

// mode "request": ProxyAdmin files and tracks requests.
// mode "review": Admin approves or rejects them.
export default function ReimbursementManagement({ api, mode = 'request' }) {
  const [date, setDate] = useState(todayTaipei());
  const [preview, setPreview] = useState(null);
  const [note, setNote] = useState('');
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = mode === 'review'
        ? await api.listAdminReimbursements({})
        : await api.listMyReimbursements();
      setRequests(result?.requests || []);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [api, mode]);

  useEffect(() => { void reload(); }, [reload]);

  useEffect(() => {
    if (mode !== 'request' || !date) return undefined;
    let cancelled = false;
    setPreview(null);
    api.previewReimbursement({ date })
      .then((result) => { if (!cancelled) setPreview(result); })
      .catch((err) => { if (!cancelled) setError(errorMessage(err)); });
    return () => { cancelled = true; };
  }, [api, mode, date, requests.length]);

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      await api.createReimbursement({ orderDate: date, note });
      setNote('');
      await reload();
      await Swal.fire({ icon: 'success', title: '已送出請款申請', timer: 1500, showConfirmButton: false });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const decide = async (request, decision) => {
    let reviewNote = '';
    if (decision === 'reject') {
      const { isConfirmed, value } = await Swal.fire({
        title: '拒絕這筆請款？',
        input: 'text',
        inputPlaceholder: '拒絕理由（選填）',
        showCancelButton: true,
        confirmButtonText: '拒絕',
        cancelButtonText: '取消'
      });
      if (!isConfirmed) return;
      reviewNote = value || '';
    } else {
      const { isConfirmed } = await Swal.fire({
        title: '同意這筆請款？',
        text: `${request.requesterName || ''} ${request.orderDate}，$${request.amount} 會加入對方的餘額。`,
        showCancelButton: true,
        confirmButtonText: '同意',
        cancelButtonText: '取消'
      });
      if (!isConfirmed) return;
    }
    setBusy(true);
    setError('');
    try {
      await api.decideReimbursement({ requestId: request.requestId, decision, note: reviewNote });
      await reload();
    } catch (err) {
      setError(errorMessage(err));
      await reload();
    } finally {
      setBusy(false);
    }
  };

  const canSubmit = mode === 'request' && preview && !preview.existingRequest
    && preview.orderCount > 0 && !busy;

  return (
    <section aria-label={mode === 'review' ? '請款審核' : '請款'} className="space-y-3">
      <h2 className="text-xl font-bold text-[#2C4A3E]">{mode === 'review' ? '請款審核' : '請款'}</h2>

      {mode === 'request' && (
        <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
          <label className="block text-sm font-semibold text-slate-700">
            訂單日期
            <input type="date" value={date} max={todayTaipei()} onChange={(e) => setDate(e.target.value)}
              className="mt-1 block min-h-11 w-full rounded-lg border border-slate-300 px-3" />
          </label>
          {!preview && <LoadingNote label="該日全部訂單" />}
          {preview && (
            <div className="space-y-2">
              <OrderList orders={preview.orders} />
              <p className="font-bold text-[#2C4A3E]">
                {preview.orderCount ? `共 ${preview.orderCount} 筆，當天全部訂單總額 $${preview.amount}` : '這一天沒有有效訂單。'}
              </p>
              {preview.existingRequest && (
                <p className="text-sm text-amber-700">
                  這一天已有請款（{STATUS_LABELS[preview.existingRequest.status]}），不能重複申請。
                </p>
              )}
            </div>
          )}
          <input type="text" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)}
            placeholder="備註（選填）" className="min-h-11 w-full rounded-lg border border-slate-300 px-3" />
          <button type="button" disabled={!canSubmit} onClick={submit}
            className="min-h-12 w-full rounded-xl bg-[#2C4A3E] font-bold text-white disabled:opacity-40">
            申請請款
          </button>
        </div>
      )}

      {error && <p role="alert" className="text-sm font-semibold text-red-700">{error}</p>}
      {loading && <LoadingNote label="請款紀錄" />}
      {!loading && !requests.length && <p className="text-sm text-slate-500">目前沒有請款紀錄。</p>}

      <ul className="space-y-2">
        {requests.map((request) => (
          <li key={request.requestId} className="space-y-2 rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="font-bold text-[#2C4A3E]">
                {mode === 'review' && request.requesterName ? `${request.requesterName}・` : ''}{request.orderDate}
              </span>
              <StatusBadge status={request.status} />
            </div>
            <p className="text-sm text-slate-700">${request.amount}（{request.orderCount} 筆）</p>
            {request.requesterNote && <p className="text-sm text-slate-500">備註：{request.requesterNote}</p>}
            {request.reviewNote && <p className="text-sm text-slate-500">審核意見：{request.reviewNote}</p>}
            {mode === 'review' && <OrderList orders={request.orders} />}
            {mode === 'review' && request.status === 'PENDING' && (
              <div className="flex gap-2">
                <button type="button" disabled={busy} onClick={() => decide(request, 'approve')}
                  className="min-h-11 flex-1 rounded-lg bg-[#2C4A3E] font-bold text-white disabled:opacity-40">同意</button>
                <button type="button" disabled={busy} onClick={() => decide(request, 'reject')}
                  className="min-h-11 flex-1 rounded-lg bg-slate-100 font-bold text-slate-700 disabled:opacity-40">拒絕</button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

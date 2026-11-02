import { useState } from 'react';
import Swal from '../../lib/swal';
import { createClientRequestKey } from '../../api/clientRequestKeys';

const ERROR_MESSAGES = {
  WITHDRAW_EXCEEDS_BALANCE: '提領金額不能超過目前餘額。',
  WITHDRAW_AMOUNT_INVALID: '提領金額必須是大於 0 的整數。',
  VENDOR_BALANCE_FORBIDDEN: '廠商帳號沒有餘額可提領。',
  MUTATION_CONFLICT: '餘額剛剛有變動，請重新確認後再試。'
};

// Admin registers a cash-out after transferring money to the member.
export default function WithdrawModal({ user, api, onClose, onDone }) {
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [requestKey] = useState(() => createClientRequestKey('withdraw'));
  if (!user) return null;

  const submit = async () => {
    const value = Number(String(amount).trim());
    if (!Number.isSafeInteger(value) || value <= 0) {
      setError(ERROR_MESSAGES.WITHDRAW_AMOUNT_INVALID);
      return;
    }
    if (value > Number(user.balance || 0)) {
      setError(ERROR_MESSAGES.WITHDRAW_EXCEEDS_BALANCE);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await api.withdrawBalance({
        targetUserId: user.userId, amount: value, note: note.trim(), idempotencyKey: requestKey
      });
      const data = await res.json();
      if (!data.success) {
        setError(ERROR_MESSAGES[data.code] || data.message || '提領失敗。');
        return;
      }
      await onDone(data.newBalance);
      await Swal.fire({ icon: 'success', title: '已登記提領', text: `${user.name} 的餘額已扣除 $${value}。` });
    } catch (err) {
      setError(ERROR_MESSAGES[err?.code] || (err?.code ? `提領失敗（${err.code}）。` : '目前無法完成提領，請稍後再試。'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-label="登記提領">
      <div className="w-full max-w-sm space-y-4 rounded-3xl bg-white p-6 shadow-2xl">
        <h3 className="text-base font-bold text-[#2C4A3E]">登記提領：{user.name}</h3>
        <p className="rounded-2xl bg-emerald-50 p-3 text-xs text-emerald-900">
          請先轉帳給對方，再登記。目前餘額 <strong>${Number(user.balance || 0)}</strong>，登記後會立即扣除。
        </p>
        <label className="block text-sm font-bold text-gray-600" htmlFor="withdraw-amount">提領金額</label>
        <input id="withdraw-amount" type="number" min="1" step="1" inputMode="numeric" value={amount}
          onChange={(e) => setAmount(e.target.value)} disabled={busy}
          className="w-full rounded-2xl border border-gray-200 bg-gray-50 p-3.5 text-sm" />
        <label className="block text-sm font-bold text-gray-600" htmlFor="withdraw-note">備註</label>
        <input id="withdraw-note" type="text" value={note} maxLength={200}
          onChange={(e) => setNote(e.target.value)} disabled={busy}
          className="w-full rounded-2xl border border-gray-200 bg-gray-50 p-3.5 text-sm" />
        {error && <p role="alert" className="text-sm font-semibold text-red-700">{error}</p>}
        <div className="flex gap-3">
          <button type="button" onClick={onClose} disabled={busy}
            className="w-1/2 rounded-2xl bg-gray-100 py-3 text-sm font-bold text-gray-600 disabled:opacity-50">取消</button>
          <button type="button" onClick={submit} disabled={busy}
            className="w-1/2 rounded-2xl bg-[#2C4A3E] py-3 text-sm font-bold text-white disabled:bg-gray-300">
            {busy ? '處理中...' : '確認提領'}
          </button>
        </div>
      </div>
    </div>
  );
}

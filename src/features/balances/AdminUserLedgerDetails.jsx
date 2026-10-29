import { useEffect, useState } from 'react';
import { apiClient } from '../../api/apiClient';
import { formatDateTime, getTaipeiYearMonth } from '../../dateUtils';
import { formatBalanceAmount, formatSignedAmount } from './formatters';
import { formatEmployeeId } from '../../components/userIdentityDisplay';
import LoadingNote from '../../components/ui/LoadingNote';

const thisMonth = () => {
  const { year, month } = getTaipeiYearMonth();
  return `${year}-${String(month).padStart(2, '0')}`;
};

// Admin-only, read-only panel. This endpoint authenticates the original
// actor and does not accept a View As credential or identity substitution.
export default function AdminUserLedgerDetails({ user, onBack }) {
  const [month, setMonth] = useState(thisMonth);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!user?.userId) return undefined;
    let live = true;
    setResult(null);
    setError('');
    setLoading(true);
    apiClient.getAdminUserLedger({ userId: user.userId, month })
      .then(async response => {
        const body = await response.json();
        if (!response.ok || body?.success === false) throw new Error('LEDGER_READ_FAILED');
        if (live) setResult(body);
      })
      .catch(() => { if (live) setError('交易明細讀取失敗，請檢查管理權限或稍後重試。'); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [user?.userId, month]);

  return <section className="space-y-3" aria-label="使用者餘額與交易明細">
    <button type="button" onClick={onBack} className="text-sm text-emerald-800 font-bold">← 返回使用者清單</button>
    <div className="rounded-xl bg-emerald-50 p-3">
      <div className="font-bold">{user.name || '未命名使用者'}</div>
      <div className="text-xs text-gray-600">員編 {formatEmployeeId(user.employeeId)}</div>
      <div className="text-sm mt-1">目前餘額：<strong>{formatBalanceAmount(result?.currentBalance ?? user.balance)}</strong></div>
      <p className="text-xs text-gray-500">僅供管理者查詢，不會變更訂單或帳戶餘額。</p>
    </div>
    <label className="block text-sm">交易月份
      <input type="month" className="ml-2 rounded-lg border p-1" value={month}
        onChange={event => setMonth(event.target.value)} />
    </label>
    {loading ? <LoadingNote label="交易紀錄" compact /> :
      error ? <p role="alert" className="text-sm text-red-700">{error}</p> :
      result && <>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>期初：{result.openingBalance == null ? '待確認' : formatBalanceAmount(result.openingBalance)}</div>
          <div>期末：{formatBalanceAmount(result.closingBalance)}</div>
          <div>入帳：{formatBalanceAmount(result.totalCredit)}</div>
          <div>扣款：{formatBalanceAmount(result.totalDebit)}</div>
        </div>
        {result.openingBalancePolicyRequired && <p role="alert" className="text-amber-700 text-xs">期初餘額政策待確認。</p>}
        <div className="max-h-72 overflow-y-auto space-y-2">
          {result.transactions?.length ? result.transactions.map((tx, index) =>
            <article key={tx.transactionId || index} className="rounded-lg border p-2 text-xs">
              <div className="flex justify-between gap-2"><strong>{tx.description || tx.type}</strong><span>{formatSignedAmount(tx.amount)}</span></div>
              <div className="text-gray-500">{formatDateTime(tx.occurredAt)}</div>
              <div className="text-gray-600">交易後餘額：{formatBalanceAmount(tx.balanceAfter)}</div>
            </article>) :
            <p className="text-gray-500 text-sm">這個月份沒有交易紀錄。</p>}
        </div>
      </>}
  </section>;
}

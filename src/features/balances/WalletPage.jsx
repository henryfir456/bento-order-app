import React from 'react';
import { formatBalanceAmount, formatSignedAmount } from './formatters';
import { formatDateTime } from '../../dateUtils';
import { formatTransactionDescription } from './topupMethods';
export default function WalletPage({ balance, year, month, history, summary, loading, error, onMonthShift }) {
  return <section aria-label="我的餘額" className="space-y-4 pb-6">
    <header className="rounded-2xl bg-emerald-900 p-5 text-white">
      <h2 className="text-sm">目前餘額</h2>
      <p className="mt-1 text-3xl font-bold">{formatBalanceAmount(balance)}</p>
    </header>
    <div className="flex items-center justify-between rounded-xl border bg-white p-3">
      <button type="button" aria-label="上個月" className="min-h-11 min-w-11 rounded-lg border" disabled={loading} onClick={() => onMonthShift(-1)}>‹</button>
      <strong>{year} 年 {month} 月</strong>
      <button type="button" aria-label="下個月" className="min-h-11 min-w-11 rounded-lg border" disabled={loading} onClick={() => onMonthShift(1)}>›</button>
    </div>
    {loading ? <p role="status">資料載入中…</p> : error ? <p role="alert" className="text-rose-700">{error}</p> : <>
      <div className="grid grid-cols-2 gap-2 rounded-xl bg-white p-4 text-sm">
        <p>月初：{formatBalanceAmount(summary.openingBalance)}</p>
        <p>月底：{formatBalanceAmount(summary.closingBalance)}</p>
        <p>入帳：{formatBalanceAmount(summary.totalCredit)}</p>
        <p>扣款：{formatBalanceAmount(summary.totalDebit)}</p>
      </div>
      <h3 className="font-bold">交易紀錄</h3>
      {history.length === 0 ? <p className="rounded-xl bg-white p-4 text-sm">本月沒有交易紀錄。</p>
        : history.map((item,index) => <article key={item.transactionId || index} className="rounded-xl border bg-white p-3 text-sm">
          <div className="flex justify-between gap-3"><strong>{formatTransactionDescription(item)}</strong><strong>{formatSignedAmount(item.amount ?? item.changeAmount)}</strong></div>
          <div className="mt-1 text-xs text-slate-500">{formatDateTime(item.occurredAt || item.timestamp)}</div>
          <div className="mt-1 text-xs">結餘 {formatBalanceAmount(item.balanceAfter ?? item.balance)}</div>
        </article>)}
    </>}
  </section>;
}

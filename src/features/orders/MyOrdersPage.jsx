import React, { useMemo, useState } from 'react';

export default function MyOrdersPage({ ordersMap, onSelectDate, onRefresh, loading, error, isViewAsMode }) {
  const [filterMonth, setFilterMonth] = useState('');
  const dates = useMemo(() => Object.keys(ordersMap || {})
    .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date) && Boolean(ordersMap[date]))
    .filter((date) => !filterMonth || date.startsWith(filterMonth))
    .sort().reverse(), [ordersMap, filterMonth]);
  return <section aria-label="我的訂單" className="space-y-4 pb-6">
    <header className="flex items-start justify-between gap-2">
      <div>
        <h2 className="text-xl font-bold text-[#2C4A3E]">我的訂單</h2>
        <p className="mt-1 text-xs text-slate-500">包含過去已完成與目前有效的訂餐日期，明細以正式系統資料為準。</p>
      </div>
      <button type="button" onClick={onRefresh} disabled={loading}
        className="min-h-11 shrink-0 rounded-xl border border-emerald-700 px-3 text-sm font-bold text-emerald-800 disabled:opacity-50">重新整理</button>
    </header>
    {isViewAsMode && <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">目前是唯讀檢視模式，不能變更訂單。</p>}
    <label className="block text-sm text-slate-600">篩選月份
      <input type="month" value={filterMonth} onChange={(event) => setFilterMonth(event.target.value)}
        className="mt-1 block min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3" />
    </label>
    {filterMonth && <button type="button" className="text-sm font-semibold text-emerald-800 underline" onClick={() => setFilterMonth('')}>顯示所有月份</button>}
    {loading ? <p role="status" className="rounded-xl border bg-white p-5 text-sm">正在取得最新訂單…</p>
      : error ? <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</p>
      : dates.length === 0 ? <p className="rounded-xl border bg-white p-5 text-sm text-slate-500">{filterMonth ? '這個月份沒有訂餐紀錄。' : '目前沒有有效或已完成的訂餐紀錄。'}</p>
        : <div className="space-y-2">
          {dates.map((date) => <button key={date} type="button" onClick={() => onSelectDate(date)}
            className="flex min-h-14 w-full items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 text-left focus-visible:outline-2 focus-visible:outline-emerald-700 hover:border-emerald-500">
            <span className="font-semibold text-slate-800">{date}</span>
            <span className="text-sm font-bold text-emerald-700">查看訂單 →</span>
          </button>)}
        </div>}
  </section>;
}

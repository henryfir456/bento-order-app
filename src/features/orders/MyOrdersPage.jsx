import React, { useMemo, useState } from 'react';
import { formatBalanceAmount } from '../balances/formatters';
import { getTaipeiYearMonth } from '../../dateUtils';

export default function MyOrdersPage({ orders, onRefresh, loading, error, isViewAsMode }) {
  const [filterMonth, setFilterMonth] = useState(() => { const { year, month } = getTaipeiYearMonth(); return `${year}-${String(month).padStart(2, '0')}`; });
  const [selectedOrderId, setSelectedOrderId] = useState(null);
  const filtered = useMemo(() => (orders || []).filter((order) => !filterMonth || order.date.startsWith(filterMonth)), [orders, filterMonth]);
  const selected = filtered.find((order) => order.orderId === selectedOrderId);

  return <section aria-label="我的訂單" className="space-y-4 pb-6">
    <header className="flex items-start justify-between gap-2">
      <div>
        <h2 className="text-xl font-bold text-[#2C4A3E]">我的訂單</h2>
      </div>
      <button type="button" onClick={onRefresh} disabled={loading}
        className="min-h-11 shrink-0 rounded-xl border border-emerald-700 px-3 text-sm font-bold text-emerald-800 disabled:opacity-50">重新整理</button>
    </header>
    {isViewAsMode && <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">目前為唯讀檢視模式。</p>}
    <label className="block text-sm text-slate-600"><span className="sr-only">選擇月份</span>
      <input type="month" value={filterMonth} onChange={(e) => { setFilterMonth(e.target.value); setSelectedOrderId(null); }}
        className="mt-1 block min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3" />
    </label>
    {filterMonth && <button type="button" className="text-sm font-semibold text-emerald-800 underline" onClick={() => setFilterMonth('')}>顯示所有月份</button>}
    {loading ? <p role="status" className="rounded-xl bg-white p-4 text-sm">正在取得最新訂單…</p> :
      error ? <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</p> :
      filtered.length === 0 ? <p className="rounded-xl bg-white p-4 text-sm text-slate-500">{filterMonth ? '這個月份沒有訂單。' : '目前沒有有效或已完成的訂單。'}</p> :
      <div className="space-y-2">
        {filtered.map((order) => <article key={order.orderId} className="rounded-xl border border-slate-200 bg-white">
          <button type="button" aria-expanded={selectedOrderId === order.orderId}
            onClick={() => setSelectedOrderId(selectedOrderId === order.orderId ? null : order.orderId)}
            className="flex min-h-14 w-full items-center justify-between gap-2 px-4 py-3 text-left focus-visible:outline-2 focus-visible:outline-emerald-700">
            <span><strong className="block text-sm">{order.date}</strong><span className="text-xs text-slate-500">{order.vendor || '餐點明細'} · {order.status === 'COMPLETED' ? '已完成' : '已訂餐'}</span></span>
            <span className="shrink-0 font-bold text-emerald-800">{formatBalanceAmount(order.totalAmount)} {selectedOrderId === order.orderId ? '⌃' : '⌄'}</span>
          </button>
          {selected?.orderId === order.orderId && <div className="space-y-2 border-t border-slate-100 px-4 py-3 text-sm">
            <div>領取樓層：{order.floor || '未提供'}</div>
            {order.items.map((item, index) => <div key={index} className="flex justify-between gap-2">
              <span>{item.name} × {item.quantity}</span><span>{formatBalanceAmount(item.subtotal)}</span>
            </div>)}
            {order.note && <p className="text-slate-600">備註：{order.note}</p>}
            <p className="text-xs text-slate-500">如需變更尚未截止的訂單，請到「訂餐」選擇該日期；實際權限由伺服器確認。</p>
          </div>}
        </article>)}
      </div>}
  </section>;
}

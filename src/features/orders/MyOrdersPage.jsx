import React, { useMemo, useState } from 'react';
import { formatBalanceAmount } from '../balances/formatters';
import { getTaipeiYearMonth } from '../../dateUtils';

export default function MyOrdersPage({ orders, onRefresh, loading, error, isViewAsMode }) {
  const [filterMonth, setFilterMonth] = useState(() => { const { year, month } = getTaipeiYearMonth(); return `${year}-${String(month).padStart(2, '0')}`; });
  const filtered = useMemo(() => (orders || []).filter((order) => order.date.startsWith(filterMonth)), [orders, filterMonth]);

  return <section aria-label="我的訂單" className="space-y-4 pb-6">
    <header>
      <h2 className="text-xl font-bold text-[#2C4A3E]">我的訂單</h2>
    </header>
    {isViewAsMode && <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">目前為唯讀檢視模式。</p>}
    <label className="block text-sm text-slate-600"><span className="sr-only">選擇月份</span>
      <input type="month" value={filterMonth} onChange={(e) => { if (e.target.value) setFilterMonth(e.target.value); }}
        className="mt-1 block min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3" />
    </label>
    {loading ? <p role="status" className="rounded-xl bg-white p-4 text-sm">正在取得最新訂單…</p> :
      error ? <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}<button type="button" onClick={onRefresh} className="ml-3 min-h-11 font-semibold underline">重試</button></div> :
      filtered.length === 0 ? <p className="rounded-xl bg-white p-4 text-sm text-slate-500">這個月份沒有訂單。</p> :
      <div className="space-y-2">
        {filtered.map((order) => <article key={order.orderId} className="rounded-xl border border-slate-200 bg-white">
          <div className="flex min-h-14 items-center justify-between gap-2 px-4 py-3">
            <span><strong className="block text-sm">{order.date}</strong><span className="text-xs text-slate-500">{order.vendor || '餐點明細'}{order.status && !['ACTIVE', 'ORDERED'].includes(order.status) ? ` · ${order.status === 'COMPLETED' ? '已完成' : order.status === 'CANCELLED' ? '已取消' : '狀態待確認'}` : ''}</span></span>
            <span className="shrink-0 font-bold text-emerald-800">{formatBalanceAmount(order.totalAmount)}</span>
          </div>
          <div className="space-y-2 border-t border-slate-100 px-4 py-3 text-sm">
            <div>領取樓層：{order.floor || '未提供'}</div>
            {(order.items || []).map((item, index) => <div key={index} className="flex justify-between gap-2">
              <span>{item.name} × {item.quantity}</span><span>{formatBalanceAmount(item.subtotal)}</span>
            </div>)}
            {order.note && <p className="text-slate-600">備註：{order.note}</p>}
          </div>
        </article>)}
      </div>}
  </section>;
}

import React from 'react';
import { currency, dayStatusLabel, formatTaipeiTime, vendorItemLabel } from './vendorDayFormat';

// One service day for the vendor: status, totals and the prep list sorted by
// quantity. Shared by the Today tab and the calendar day dialog.
export default function VendorDaySummary({ day }) {
  return <>
    <div className="rounded-2xl border border-emerald-900/10 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-lg font-bold text-[#2C4A3E]">{day.serviceDate}</h3>
        <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${day.cutoffPassed ? 'bg-emerald-100 text-emerald-900' : 'bg-amber-100 text-amber-900'}`}>{dayStatusLabel(day)}</span>
      </div>
      <p className="mt-1 text-xs text-slate-500">截止時間：{formatTaipeiTime(day.cutoffAt)}</p>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl bg-slate-50 p-3"><div className="text-xs text-slate-500">份數</div><div className="mt-1 text-2xl font-extrabold tabular-nums text-[#2C4A3E]">{day.portionCount}</div></div>
        <div className="rounded-xl bg-slate-50 p-3"><div className="text-xs text-slate-500">訂單</div><div className="mt-1 text-2xl font-extrabold tabular-nums text-slate-800">{day.orderCount}</div></div>
        <div className="rounded-xl bg-slate-50 p-3"><div className="text-xs text-slate-500">金額</div><div className="mt-1 text-lg font-extrabold tabular-nums text-slate-800">{currency(day.amountTwd)}</div></div>
      </div>
      {!day.cutoffPassed && <p className="mt-2 text-xs text-amber-800">尚未截止，數量可能還會變動。</p>}
    </div>
    <div className="rounded-2xl border border-emerald-900/10 bg-white p-4 shadow-sm">
      <h3 className="font-bold text-[#2C4A3E]">備餐清單</h3>
      <ul className="mt-2 divide-y divide-slate-100">
        {[...(day.items || [])].sort((a, b) => b.quantity - a.quantity).map((item, index) => (
          <li key={`${item.name}-${item.variantKey}-${index}`} className="flex items-center justify-between gap-3 py-2">
            <span className="min-w-0 break-words text-base">{vendorItemLabel(item)}</span>
            <span className="shrink-0 text-xl font-extrabold tabular-nums text-[#2C4A3E]">× {item.quantity}</span>
          </li>
        ))}
      </ul>
    </div>
  </>;
}

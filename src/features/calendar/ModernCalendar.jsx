import React, { useMemo, useState } from 'react';
import { formatDateInput, getWeekdayLeadingBlankCount } from '../../dateUtils';
import { getCalendarDailyFlavorImage } from '../orders/dailyFlavorPresentation.js';

export default function ModernCalendar({ currentMonth, events, orders, onSelectDate, onPreviousMonth, onNextMonth }) {
  const entries = useMemo(() => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    return Array.from({ length: new Date(year, month + 1, 0).getDate() }, (_, index) => {
      const day = index + 1;
      const date = new Date(year, month, day);
      if (date.getDay() === 0 || date.getDay() === 6) return null;
      const key = formatDateInput(date);
      const event = events[key];
      const ordered = Boolean(orders[key]);
      const expired = Boolean(event?.isExpired || event?.expired);
      const status = !event?.vendor ? '未開團' : ordered ? '已訂' : expired ? '截止' : '可訂';
      return { day, key, event, status, ordered, expired };
    }).filter(Boolean);
  }, [currentMonth, events, orders]);
  const [selectedKey, setSelectedKey] = useState('');
  const active = entries.find((entry) => entry.key === selectedKey) || entries.find((entry) => entry.status === '可訂') || entries[0];
  const upcoming = entries.find((entry) => entry.status === '可訂' && entry.key >= formatDateInput());
  const leadingBlanks = getWeekdayLeadingBlankCount(currentMonth.getFullYear(), currentMonth.getMonth());
  const statusColor = (status) => status === '可訂' ? 'bg-emerald-50 border-emerald-300 text-emerald-900' : status === '已訂' ? 'bg-blue-50 border-blue-300 text-blue-900' : 'bg-slate-50 border-slate-200 text-slate-500';
  const imageUrl = active?.event?.dailyFlavorName ? getCalendarDailyFlavorImage(active.event, active.key) : '';
  return (
    <section className="space-y-4" aria-label="新版訂餐月曆">
      {upcoming && (
        <button type="button" onClick={() => setSelectedKey(upcoming.key)}
          className="w-full rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-left shadow-sm">
          <span className="text-xs font-bold text-emerald-700">下一個可訂餐日</span>
          <div className="mt-1 text-base font-bold text-emerald-950">{upcoming.key} · {upcoming.event?.vendor}</div>
          <div className="mt-1 text-sm text-emerald-800">{upcoming.event?.dailyFlavorName || '點選查看當日菜單'}</div>
        </button>
      )}
      <div className="rounded-2xl border border-emerald-900/10 bg-white p-3 shadow-sm">
        <div className="flex items-center justify-between gap-2 pb-3">
          <h2 className="text-xl font-bold text-[#2C4A3E]">{currentMonth.getFullYear()} 年 {currentMonth.getMonth() + 1} 月</h2>
          <div className="flex gap-1">
            <button type="button" aria-label="上一個月" onClick={onPreviousMonth} className="min-h-11 min-w-11 rounded-lg border">◀</button>
            <button type="button" aria-label="下一個月" onClick={onNextMonth} className="min-h-11 min-w-11 rounded-lg border">▶</button>
          </div>
        </div>
        <div className="grid grid-cols-5 gap-1 text-center text-xs text-slate-500">{['一','二','三','四','五'].map((day) => <div key={day}>{day}</div>)}</div>
        <div className="mt-2 grid grid-cols-5 gap-1">
          {Array.from({length: leadingBlanks},(_,index)=><div key={`blank-${index}`} aria-hidden="true" />)}
          {entries.map((entry) => (
            <button type="button" key={entry.key} onClick={() => setSelectedKey(entry.key)}
              aria-label={`${entry.key} ${entry.event?.vendor || ''} ${entry.status}`}
              aria-pressed={active?.key === entry.key}
              className={`min-h-[72px] min-w-0 rounded-xl border p-1.5 text-left transition focus-visible:outline-2 focus-visible:outline-emerald-700 ${statusColor(entry.status)} ${active?.key === entry.key ? 'ring-2 ring-emerald-700' : ''}`}>
              <div className="text-base font-bold">{entry.day}</div>
              <div className="mt-2 text-[11px] font-semibold leading-tight">{entry.status}</div>
            </button>
          ))}
        </div>
      </div>
      {active && (
        <div className="rounded-2xl border border-emerald-100 bg-white p-4 shadow-sm" aria-live="polite">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-lg font-bold text-[#2C4A3E]">{active.key}</h3>
            <span className={`rounded-lg px-2 py-1 text-xs font-bold ${statusColor(active.status)}`}>{active.status}</span>
          </div>
          <p className="text-base font-semibold">{active.event?.vendor || '當日未開團'}</p>
          {active.event?.dailyFlavorName && <p className="mt-2 break-words text-sm text-amber-800">{active.event.dailyFlavorName}</p>}
          {imageUrl && <img src={imageUrl} alt={active.event.dailyFlavorName} loading="lazy" className="mt-3 h-44 w-full rounded-xl object-cover" onError={(event) => { event.currentTarget.hidden = true; }} />}
          {active.event?.vendor && (
            <button type="button" onClick={() => onSelectDate(active.key)}
              className="mt-4 min-h-11 w-full rounded-xl bg-[#2C4A3E] px-4 py-3 font-bold text-white">
              {active.ordered || active.expired ? '查看當日訂單與菜單' : '查看菜單並預訂'}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

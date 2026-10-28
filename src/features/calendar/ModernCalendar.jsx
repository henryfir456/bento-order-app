import React from 'react';
import { formatDateInput, getWeekdayLeadingBlankCount, shiftDateInput } from '../../dateUtils';
import { getCalendarDailyFlavorImage } from '../orders/dailyFlavorPresentation.js';

export default function ModernCalendar({ currentMonth, events, orders, onSelectDate, onPreviousMonth, onNextMonth, selectedKey = '', onSelectKey, layout = 'month' }) {
  const rolling = layout === 'rolling';
  const buildEntry = (date, day) => {
    const key = formatDateInput(date);
    const event = events[key];
    const ordered = Boolean(orders[key]);
    const expired = Boolean(event?.isExpired || event?.expired);
    const status = !event?.vendor ? '未開團' : ordered ? '已訂' : expired ? '截止' : '可訂';
    return { day, key, event, status, ordered, expired };
  };
  const entries = (() => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    return Array.from({ length: new Date(year, month + 1, 0).getDate() }, (_, index) => {
      const day = index + 1;
      const date = new Date(year, month, day);
      if (date.getDay() === 0 || date.getDay() === 6) return null;
      return buildEntry(date, day);
    }).filter(Boolean);
  })();
  const weekRows = (() => {
    if (!rolling) return [];
    const today = formatDateInput(new Date());
    const dow = new Date(`${today}T12:00:00`).getDay();
    const monday = shiftDateInput(today, dow === 0 ? -6 : 1 - dow);
    return [['上週', -7], ['本週', 0], ['下週', 7]].map(([label, offset]) => ({
      label,
      entries: [0, 1, 2, 3, 4].map((i) => {
        const key = shiftDateInput(monday, offset + i);
        return buildEntry(new Date(`${key}T12:00:00`), Number(key.slice(8)));
      })
    }));
  })();
  const visibleEntries = rolling ? weekRows.flatMap((row) => row.entries) : entries;
  const todayKey = formatDateInput(new Date());
  const active = visibleEntries.find((entry) => entry.key === selectedKey)
    || (rolling && visibleEntries.find((entry) => entry.key === todayKey))
    || visibleEntries.find((entry) => entry.status === '可訂') || visibleEntries[0];
  const isCai = String(active?.event?.vendor || '').trim() === '蔡老師';
  const imageUrl = isCai && active?.event?.dailyFlavorName ? getCalendarDailyFlavorImage(active.event, active.key) : '';
  const weekdayText = ['日', '一', '二', '三', '四', '五', '六'];
  const dateLabel = active ? `${active.key}(${weekdayText[new Date(`${active.key}T12:00:00`).getDay()]})` : '';
  const leadingBlanks = getWeekdayLeadingBlankCount(currentMonth.getFullYear(), currentMonth.getMonth());
  const statusColor = (status) => status === '可訂' ? 'bg-emerald-50 border-emerald-300 text-emerald-900' : status === '已訂' ? 'bg-blue-50 border-blue-300 text-blue-900' : 'bg-slate-50 border-slate-200 text-slate-500';
  const renderCell = (entry) => (
            <button type="button" key={entry.key} onClick={() => onSelectKey(entry.key)}
              aria-label={`${entry.key} ${entry.event?.vendor || ''} ${entry.status}`}
              aria-pressed={active?.key === entry.key}
              className={`min-h-[94px] min-w-0 rounded-xl border p-1.5 text-left transition focus-visible:outline-2 focus-visible:outline-emerald-700 ${statusColor(entry.status)} ${active?.key === entry.key ? 'ring-2 ring-emerald-700' : ''}`}>
              <div className="text-base font-bold">{entry.day}</div>
              <div className="mt-1 break-words text-[10px] leading-snug text-gray-700" title={entry.event?.vendor === "蔡老師" ? (entry.event?.dailyFlavorName || "蔡老師") : (entry.event?.vendor || entry.event?.dailyFlavorName || "")}>{entry.event?.vendor ? (entry.event.vendor === '蔡老師' ? (entry.event.dailyFlavorName || entry.event.vendor) : entry.event.vendor) : (entry.event?.dailyFlavorName || '未開團')}</div>
              <div className="mt-1 text-[10px] font-semibold leading-tight">{entry.status}</div>
            </button>
  );
  return (
    <section className="space-y-4" aria-label={rolling ? '滾動三週訂餐' : '新版訂餐月曆'}>
      <div className="rounded-2xl border border-emerald-900/10 bg-white p-3 shadow-sm">
        {rolling ? (
          <div className="space-y-2">
            <div className="grid grid-cols-5 gap-1 pl-9 text-center text-xs text-slate-500">{['一','二','三','四','五'].map((day) => <div key={day}>{day}</div>)}</div>
            {weekRows.map((row) => (
              <div key={row.label} className="flex items-stretch gap-1">
                <div className={`flex w-8 shrink-0 items-center justify-center text-xs font-bold ${row.label === '本週' ? 'text-[#2C4A3E]' : 'text-slate-500'}`}>{row.label}</div>
                <div className="grid min-w-0 flex-1 grid-cols-5 gap-1">{row.entries.map(renderCell)}</div>
              </div>
            ))}
          </div>
        ) : (
          <>
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
          {entries.map(renderCell)}
        </div>
          </>
        )}
      </div>
      {active && (
        <div className="rounded-2xl border border-emerald-100 bg-white p-4 shadow-sm" aria-live="polite">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-lg font-bold text-[#2C4A3E]">{dateLabel}</h3>
            <span className={`rounded-lg px-2 py-1 text-xs font-bold ${statusColor(active.status)}`}>{active.status}</span>
          </div>
          <p className="text-base font-semibold">{active.event?.vendor || '當日未開團'}</p>
          {isCai && active.event?.dailyFlavorName && <p className="mt-2 break-words text-sm text-amber-800">{active.event.dailyFlavorName}</p>}
          {imageUrl && <img src={imageUrl} alt={active.event.dailyFlavorName} loading="lazy" decoding="async" className="mt-3 h-44 w-full rounded-xl object-cover" onError={(event) => { event.currentTarget.hidden = true; }} />}
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

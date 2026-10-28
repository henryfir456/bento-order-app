import React, { useMemo } from 'react';
import { formatDateInput } from '../../dateUtils';
import { buildRollingWeeks } from './rollingWeeks.js';

const WEEKDAYS = ['一', '二', '三', '四', '五'];

const statusOf = (event, ordered) => {
  const expired = Boolean(event?.isExpired || event?.expired);
  if (!event?.vendor) return '未開團';
  return ordered ? '已訂' : expired ? '截止' : '可訂';
};

const statusColor = (status) => status === '可訂'
  ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
  : status === '已訂'
    ? 'bg-blue-50 border-blue-300 text-blue-900'
    : 'bg-slate-50 border-slate-200 text-slate-500';

export default function RollingCalendar({ events, orders, onSelectDate, selectedKey = '', onSelectKey }) {
  const todayKey = formatDateInput(new Date());
  const weeks = useMemo(() => buildRollingWeeks(todayKey), [todayKey]);
  const allDays = weeks.flatMap((week) => week.days);
  const active = allDays.find((entry) => entry.key === selectedKey)
    || allDays.find((entry) => entry.key >= todayKey && statusOf(events[entry.key], Boolean(orders[entry.key])) === '可訂')
    || allDays.find((entry) => entry.key === todayKey)
    || allDays[0];
  const activeEvent = events[active.key];
  const activeOrdered = Boolean(orders[active.key]);
  const activeStatus = statusOf(activeEvent, activeOrdered);
  const isCai = String(activeEvent?.vendor || '').trim() === '蔡老師';
  const vendorText = (event) => (event?.vendor === '蔡老師' ? (event.dailyFlavorName || event.vendor) : (event?.vendor || event?.dailyFlavorName || '未開團'));

  return (
    <section className="space-y-4" aria-label="滾動訂餐月曆">
      <div className="rounded-2xl border border-emerald-900/10 bg-white p-3 shadow-sm">
        <div className="grid grid-cols-[2.5rem_repeat(5,minmax(0,1fr))] gap-1 pb-1 text-center text-xs text-slate-500">
          <div aria-hidden="true" />
          {WEEKDAYS.map((day) => <div key={day}>{day}</div>)}
        </div>
        <div className="space-y-1">
          {weeks.map((week) => (
            <div key={week.label} className="grid grid-cols-[2.5rem_repeat(5,minmax(0,1fr))] items-stretch gap-1">
              <div className={`flex items-center justify-center text-xs font-bold ${week.label === '本週' ? 'text-emerald-800' : 'text-slate-500'}`}>{week.label}</div>
              {week.days.map((entry) => {
                const event = events[entry.key];
                const status = statusOf(event, Boolean(orders[entry.key]));
                return (
                  <button type="button" key={entry.key} onClick={() => onSelectKey(entry.key)}
                    aria-label={`${entry.key} ${event?.vendor || ''} ${status}`}
                    aria-pressed={active.key === entry.key}
                    className={`min-h-[88px] min-w-0 rounded-xl border p-1.5 text-left transition focus-visible:outline-2 focus-visible:outline-emerald-700 ${statusColor(status)} ${active.key === entry.key ? 'ring-2 ring-emerald-700' : ''} ${entry.key === todayKey ? 'border-2 border-emerald-700' : ''}`}>
                    <div className="text-sm font-bold">{entry.month}/{entry.day}</div>
                    <div className="mt-1 break-words text-[10px] leading-snug text-gray-700">{vendorText(event)}</div>
                    <div className="mt-1 text-[10px] font-semibold leading-tight">{status}</div>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <div className="rounded-2xl border border-emerald-100 bg-white p-4 shadow-sm" aria-live="polite">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-lg font-bold text-[#2C4A3E]">{active.key}</h3>
          <span className={`rounded-lg px-2 py-1 text-xs font-bold ${statusColor(activeStatus)}`}>{activeStatus}</span>
        </div>
        <p className="text-base font-semibold">{activeEvent?.vendor || '當日未開團'}</p>
        {isCai && activeEvent?.dailyFlavorName && <p className="mt-2 break-words text-sm text-amber-800">{activeEvent.dailyFlavorName}</p>}
        {activeEvent?.vendor && (
          <button type="button" onClick={() => onSelectDate(active.key)}
            className="mt-4 min-h-11 w-full rounded-xl bg-[#2C4A3E] px-4 py-3 font-bold text-white">
            {activeOrdered || activeStatus === '截止' ? '查看當日訂單與菜單' : '查看菜單並預訂'}
          </button>
        )}
      </div>
    </section>
  );
}

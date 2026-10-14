import React, { useEffect, useMemo, useState } from 'react';
import { formatDateInput, getWeekdayLeadingBlankCount } from '../../dateUtils';
import { getCalendarDailyFlavorImage } from '../orders/dailyFlavorPresentation.js';

export default function ModernCalendar({ currentMonth, events, orders, onSelectDate, onPreviousMonth, onNextMonth, loadDailyMenu }) {
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
  const [menuDetails, setMenuDetails] = useState({ key: '', items: [], loading: false, error: '' });
  useEffect(() => {
    if (!active?.event?.vendor) return undefined;
    let cancelled = false;
    const key = active.key;
    setMenuDetails({ key, items: [], loading: true, error: '' });
    Promise.resolve().then(() => loadDailyMenu(key)).then((items) => {
      if (!cancelled) setMenuDetails({ key, items: Array.isArray(items) ? items : [], loading: false, error: '' });
    }).catch(() => {
      if (!cancelled) setMenuDetails({ key, items: [], loading: false, error: '菜單載入失敗，請點選查看菜單重試。' });
    });
    return () => { cancelled = true; };
  }, [active?.key, active?.event?.vendor, loadDailyMenu]);
  const items = menuDetails.key === active?.key ? menuDetails.items : [];
  const isCai = String(active?.event?.vendor || '').trim() === '蔡老師';
  const weekdayText = ['日', '一', '二', '三', '四', '五', '六'];
  const dateLabel = active ? `${active.key}(${weekdayText[new Date(`${active.key}T12:00:00`).getDay()]})` : '';
  const leadingBlanks = getWeekdayLeadingBlankCount(currentMonth.getFullYear(), currentMonth.getMonth());
  const statusColor = (status) => status === '可訂' ? 'bg-emerald-50 border-emerald-300 text-emerald-900' : status === '已訂' ? 'bg-blue-50 border-blue-300 text-blue-900' : 'bg-slate-50 border-slate-200 text-slate-500';
  const imageUrl = isCai && active?.event?.dailyFlavorName ? getCalendarDailyFlavorImage(active.event, active.key) : '';
  return (
    <section className="space-y-4" aria-label="新版訂餐月曆">
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
              className={`min-h-[94px] min-w-0 rounded-xl border p-1.5 text-left transition focus-visible:outline-2 focus-visible:outline-emerald-700 ${statusColor(entry.status)} ${active?.key === entry.key ? 'ring-2 ring-emerald-700' : ''}`}>
              <div className="text-base font-bold">{entry.day}</div>
              <div className="mt-1 break-words text-[10px] leading-snug text-gray-700">{entry.event?.vendor ? (entry.event.vendor === '蔡老師' ? (entry.event.dailyFlavorName || entry.event.vendor) : entry.event.vendor) : '未開團'}</div>
              <div className="mt-1 text-[10px] font-semibold leading-tight">{entry.status}</div>
            </button>
          ))}
        </div>
      </div>
      {active && (
        <div className="rounded-2xl border border-emerald-100 bg-white p-4 shadow-sm" aria-live="polite">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-lg font-bold text-[#2C4A3E]">{dateLabel}</h3>
            <span className={`rounded-lg px-2 py-1 text-xs font-bold ${statusColor(active.status)}`}>{active.status}</span>
          </div>
          <p className="text-base font-semibold">{active.event?.vendor || '當日未開團'}</p>
          {isCai && active.event?.dailyFlavorName && <p className="mt-2 break-words text-sm text-amber-800">{active.event.dailyFlavorName}</p>}
          {menuDetails.loading && <p className="mt-2 text-sm text-gray-500">正在讀取當日菜單…</p>}
          {menuDetails.error && <p role="alert" className="mt-2 text-sm text-red-700">{menuDetails.error}</p>}
          {items.map((item, index) => <div key={`${item.item_id || item.item_code || index}-${index}`} className="mt-3 flex items-center gap-3 rounded-lg border border-gray-100 p-2">
            {item.image_url && <img src={item.image_url} alt={item.item_name || '餐點'} loading="lazy" className="h-16 w-16 shrink-0 rounded-md object-cover" onError={(event) => { event.currentTarget.hidden = true; }} />}
            <div className="min-w-0 flex-1 break-words text-sm font-medium">{item.item_name || item.name}</div>
          </div>)}
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

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiClient } from '../../api/apiClient';
import { formatApiErrorDiagnostic } from '../../api/apiErrors';
import { formatDateInput, getWeekdayLeadingBlankCount } from '../../dateUtils';
import Modal from '../../components/Modal';
import VendorDaySummary from './VendorDaySummary';
import LoadingNote from '../../components/ui/LoadingNote';
import ErrorNotice from '../../components/ui/ErrorNotice';

const readJson = async (response) => {
  let data = {};
  try { data = await response.json(); } catch { /* reported below */ }
  if (!response.ok || data?.success === false || data?.error) {
    const error = new Error(data?.error || `HTTP ${response.status}`);
    error.code = data?.error || 'VENDOR_CALENDAR_REQUEST_FAILED';
    error.requestId = response.headers?.get?.('X-Request-Id') || data?.requestId || null;
    throw error;
  }
  return data;
};

const monthKey = (date) => formatDateInput(date).slice(0, 7);
const normalizeName = (value) => String(value || '').trim();

// Read-only ordering calendar for a Vendor: every weekday shows which shop
// runs that day; the vendor's own days open that day's order summary.
export default function VendorCalendar() {
  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [events, setEvents] = useState({});
  const [operations, setOperations] = useState({ vendors: [], days: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [openDate, setOpenDate] = useState('');
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++requestRef.current;
    setLoading(true);
    setError('');
    try {
      const [calendar, vendorDays] = await Promise.all([
        apiClient.getCalendar({}).then(readJson),
        apiClient.getVendorOperations({ month: monthKey(currentMonth) }).then(readJson)
      ]);
      if (requestId !== requestRef.current) return;
      setEvents(calendar.events || {});
      setOperations({
        vendors: Array.isArray(vendorDays.vendors) ? vendorDays.vendors : [],
        days: Array.isArray(vendorDays.days) ? vendorDays.days : []
      });
    } catch (requestError) {
      if (requestId === requestRef.current) {
        setError(`目前無法載入訂餐月曆，請重新整理。${formatApiErrorDiagnostic(requestError)}`);
      }
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, [currentMonth]);

  useEffect(() => {
    const timer = setTimeout(() => { void load(); }, 0);
    return () => clearTimeout(timer);
  }, [load]);

  const ownNames = useMemo(() => new Set(operations.vendors.map((vendor) => normalizeName(vendor.name))),
    [operations.vendors]);
  const daysByDate = useMemo(() => new Map(operations.days.map((day) => [day.serviceDate, day])),
    [operations.days]);

  const entries = useMemo(() => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    return Array.from({ length: new Date(year, month + 1, 0).getDate() }, (_, index) => {
      const date = new Date(year, month, index + 1);
      if (date.getDay() === 0 || date.getDay() === 6) return null;
      const key = formatDateInput(date);
      const vendor = normalizeName(events[key]?.vendor);
      const own = Boolean(vendor) && ownNames.has(vendor);
      return { day: index + 1, key, vendor, own, summary: own ? daysByDate.get(key) : null };
    }).filter(Boolean);
  }, [currentMonth, events, ownNames, daysByDate]);

  const leadingBlanks = getWeekdayLeadingBlankCount(currentMonth.getFullYear(), currentMonth.getMonth());
  const openEntry = entries.find((entry) => entry.key === openDate);
  const shiftMonth = (delta) => {
    setOpenDate('');
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + delta, 1));
  };

  return (
    <section className="space-y-3" aria-label="廠商訂餐月曆">
      <div className="rounded-2xl border border-emerald-900/10 bg-white p-3 shadow-sm">
        <div className="flex items-center justify-between gap-2 pb-3">
          <h2 className="text-xl font-bold text-[#2C4A3E]">{currentMonth.getFullYear()} 年 {currentMonth.getMonth() + 1} 月</h2>
          <div className="flex gap-1">
            <button type="button" aria-label="上一個月" onClick={() => shiftMonth(-1)} className="min-h-11 min-w-11 rounded-lg border">◀</button>
            <button type="button" aria-label="下一個月" onClick={() => shiftMonth(1)} className="min-h-11 min-w-11 rounded-lg border">▶</button>
          </div>
        </div>
        <p className="pb-2 text-xs text-slate-500">只能查看。綠色是你的團，點一下可看當天訂單總覽。</p>
        <div className="grid grid-cols-5 gap-1 text-center text-xs text-slate-500">{['一', '二', '三', '四', '五'].map((day) => <div key={day}>{day}</div>)}</div>
        <div className="mt-2 grid grid-cols-5 gap-1">
          {Array.from({ length: leadingBlanks }, (_, index) => <div key={`blank-${index}`} aria-hidden="true" />)}
          {entries.map((entry) => (
            <button type="button" key={entry.key} disabled={!entry.own}
              onClick={() => setOpenDate(entry.key)}
              aria-label={`${entry.key} ${entry.vendor || '未開團'}${entry.own ? '，你的團，查看訂單總覽' : ''}`}
              className={`min-h-[78px] min-w-0 rounded-xl border p-1.5 text-left ${entry.own
                ? 'border-emerald-300 bg-emerald-50 text-emerald-900 focus-visible:outline-2 focus-visible:outline-emerald-700'
                : (entry.vendor
                  ? 'cursor-default border-slate-200 bg-slate-50 text-slate-500'
                  : 'cursor-default border-rose-300 bg-rose-50 text-rose-700')}`}>
              <div className="text-base font-bold">{entry.day}</div>
              <div className={`mt-1 break-words leading-snug ${entry.vendor ? 'text-[10px]' : 'text-xs font-bold text-red-600'}`}>{entry.vendor || '未開團'}</div>
              {entry.own && <div className="mt-1 text-[10px] font-semibold tabular-nums">{entry.summary ? `${entry.summary.portionCount} 份` : '—'}</div>}
            </button>
          ))}
        </div>
        {loading && <LoadingNote compact />}
      </div>
      {error && <ErrorNotice message={error} onRetry={() => void load()} />}
      <Modal open={Boolean(openEntry)} title={openEntry ? `${openEntry.key} 訂單總覽` : ''} onClose={() => setOpenDate('')}>
        {openEntry && (openEntry.summary && Number(openEntry.summary.orderCount || 0) > 0
          ? <div className="space-y-3"><VendorDaySummary day={openEntry.summary} /></div>
          : <p className="text-sm text-slate-600">這天目前沒有訂單。</p>)}
      </Modal>
    </section>
  );
}

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient } from '../../api/apiClient';
import { formatApiErrorDiagnostic } from '../../api/apiErrors';
import { dishLabel } from '../../dishLabel.js';

const PERIODS = [
  { value: 'all', label: '全部' },
  { value: 'year', label: '今年' },
  { value: 'month', label: '本月' }
];
const numberFormat = new Intl.NumberFormat('zh-TW');
const formatCount = (value) => numberFormat.format(Number(value) || 0);

const readJson = async (response) => {
  let data = {};
  try { data = await response.json(); } catch { /* reported below */ }
  if (!response.ok || data?.success === false || data?.error) {
    const error = new Error(data?.error || `HTTP ${response.status}`);
    error.code = data?.error || 'VENDOR_FOOTPRINTS_REQUEST_FAILED';
    error.requestId = response.headers?.get?.('X-Request-Id') || data?.requestId || null;
    throw error;
  }
  return data;
};

function SummaryCard({ label, value, unit = '' }) {
  return <article className="rounded-2xl border border-emerald-100 bg-white p-4 shadow-sm">
    <h3 className="text-sm font-medium text-slate-600">{label}</h3>
    <p className="mt-1 text-2xl font-bold tabular-nums text-[#2C4A3E]">{formatCount(value)}{unit}</p>
  </article>;
}

// Read-only sales footprint for a Vendor: how many of each dish it has sold,
// through yesterday, for all time, this year or this month.
export default function VendorFootprints() {
  const [period, setPeriod] = useState('all');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const requestRef = useRef(0);
  const cacheRef = useRef(new Map());

  const load = useCallback(async (nextPeriod) => {
    const requestId = ++requestRef.current;
    const cached = cacheRef.current.get(nextPeriod) || null;
    if (cached) setData(cached);
    setLoading(!cached);
    setError('');
    try {
      const result = await readJson(await apiClient.getVendorFootprints({ period: nextPeriod }));
      if (requestId !== requestRef.current) return;
      cacheRef.current.set(nextPeriod, result);
      setData(result);
    } catch (requestError) {
      if (requestId === requestRef.current) {
        setError(`目前無法載入售出足跡，請稍後再試。${formatApiErrorDiagnostic(requestError)}`);
      }
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => { void load(period); }, 0);
    return () => clearTimeout(timer);
  }, [load, period]);

  const items = Array.isArray(data?.items) ? data.items : [];
  const topPortions = items.reduce((max, item) => Math.max(max, Number(item.portions) || 0), 0);
  const hasSales = Number(data?.totalPortions || 0) > 0;
  const periodLabel = period === 'year'
    ? `${data?.endDate?.slice(0, 4) || '今年'} 年`
    : period === 'month'
      ? `${data?.endDate?.slice(0, 7) || '本月'}`
      : data?.startDate
        ? `${data.startDate} 起`
        : '全部期間';

  return <section aria-label="廠商售出足跡" className="space-y-4 pb-6">
    <header className="space-y-3">
      <div>
        <h2 className="text-xl font-bold text-[#2C4A3E]">售出足跡</h2>
        <p className="mt-1 text-sm text-slate-500">{periodLabel}，統計到昨天為止。只能查看。</p>
      </div>
      <div className="grid grid-cols-3 gap-2 rounded-xl bg-slate-100 p-1" role="group" aria-label="統計期間">
        {PERIODS.map(({ value, label }) => <button
          key={value}
          type="button"
          aria-pressed={period === value}
          onClick={() => setPeriod(value)}
          className={`min-h-11 rounded-lg px-2 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-emerald-700 ${period === value ? 'bg-white text-emerald-800 shadow-sm' : 'text-slate-600 hover:bg-white/70'}`}
        >{label}</button>)}
      </div>
    </header>

    {loading ? <p role="status" className="rounded-xl bg-white p-4 text-sm text-slate-600">正在整理售出足跡…</p> : null}
    {!loading && error ? <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
      <p>{error}</p>
      <button type="button" onClick={() => void load(period)} className="mt-2 min-h-11 font-semibold underline">重試</button>
    </div> : null}
    {!loading && !error && data && !hasSales ? <p role="status" className="rounded-xl bg-white p-4 text-sm text-slate-600">這段期間還沒有可計入的售出紀錄。</p> : null}

    {!loading && !error && hasSales ? <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryCard label="累計售出份數" value={data.totalPortions} />
        <SummaryCard label="出餐天數" value={data.totalOrderDays} />
        <SummaryCard label="餐點種類" value={data.totalMealTypes} />
        <SummaryCard label="累計金額" value={data.totalAmountTwd} unit=" 元" />
      </div>

      <section aria-label="售出餐點排行" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="text-base font-bold text-[#2C4A3E]">售出餐點排行</h3>
        <ol className="mt-3 divide-y divide-slate-100">
          {items.map((item, index) => <li key={`${item.name}-${item.variantKey}-${index}`} className="min-h-12 space-y-1.5 py-2 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="flex min-w-0 items-center gap-3">
                <span className="w-6 shrink-0 text-center font-semibold tabular-nums text-slate-500">{index + 1}</span>
                <span className="min-w-0">
                  <span className="block break-words font-medium text-slate-800">{dishLabel({ name: item.name, variantKey: item.variantKey })}</span>
                  {item.resolved === false && <span className="block text-xs text-amber-800">舊資料，依原始名稱合併計算</span>}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block font-semibold tabular-nums text-emerald-800">{formatCount(item.portions)} 份</span>
                <span className="block text-xs tabular-nums text-slate-500">{formatCount(item.amountTwd)} 元</span>
              </span>
            </div>
            <div aria-hidden="true" className="ml-9 h-1.5 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-emerald-600" style={{ width: `${topPortions ? Math.max(2, Math.round(Number(item.portions) / topPortions * 100)) : 0}%` }} />
            </div>
          </li>)}
        </ol>
      </section>
    </> : null}
  </section>;
}

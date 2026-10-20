import React from 'react';

const PERIODS = [
  { value: 'all', label: '全部' },
  { value: 'year', label: '今年' },
  { value: 'month', label: '本月' }
];
const PIE_COLORS = ['#18745b', '#f0a23b', '#5585c7', '#c65b70', '#8b68aa', '#6f9a49', '#d27b45', '#4f9b9b'];
const numberFormat = new Intl.NumberFormat('zh-TW');
const formatCount = (value) => numberFormat.format(Number(value) || 0);

const piePath = (startDegrees, endDegrees) => {
  const radius = 48;
  const center = 50;
  const point = (degrees) => {
    const radians = degrees * Math.PI / 180;
    return [center + radius * Math.cos(radians), center + radius * Math.sin(radians)];
  };
  const [startX, startY] = point(startDegrees);
  const [endX, endY] = point(endDegrees);
  const largeArc = endDegrees - startDegrees > 180 ? 1 : 0;
  return `M ${center} ${center} L ${startX} ${startY} A ${radius} ${radius} 0 ${largeArc} 1 ${endX} ${endY} Z`;
};

function VendorDonutChart({ vendors }) {
  const total = vendors.reduce((sum, item) => sum + Number(item.portions || 0), 0);
  if (!total) return null;
  const formattedTotal = formatCount(total);
  const totalFontSize = Math.min(12, Math.max(6, 42 / (formattedTotal.length * 0.62)));
  let cursor = -90;
  const slices = vendors.map((vendor, index) => {
    const portions = Number(vendor.portions || 0);
    const end = cursor + portions / total * 360;
    const slice = {
      ...vendor,
      color: PIE_COLORS[index % PIE_COLORS.length],
      percent: Math.round(portions / total * 100),
      proportion: Math.min(100, Math.max(0, portions / total * 100)),
      path: vendors.length === 1 ? null : piePath(cursor, end)
    };
    cursor = end;
    return slice;
  });

  return <section aria-label="店家訂購份數" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
    <h3 className="text-base font-bold text-[#2C4A3E]">店家份數分布</h3>
    <div className="mt-3 grid grid-cols-1 items-center gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <style>{`@keyframes footprints-pie-draw { from { stroke-dasharray: 0 302; } to { stroke-dasharray: 302 302; } }\n@media (prefers-reduced-motion: reduce) { .footprints-pie-reveal { animation: none !important; } }\n.footprints-pie-reveal { animation: footprints-pie-draw 650ms ease-out both; }`}</style>
      <svg role="img" aria-label={`店家份數甜甜圈圖，共 ${formattedTotal} 份`} viewBox="0 0 100 100" className="mx-auto h-44 w-44">
        <title>店家份數甜甜圈圖，共 {formattedTotal} 份</title>
        <defs><mask id="footprints-pie-mask"><circle className="footprints-pie-reveal" cx="50" cy="50" r="48" fill="none" stroke="white" strokeWidth="100" strokeDasharray="302 302" transform="rotate(-90 50 50)" /></mask></defs>
        <g mask="url(#footprints-pie-mask)">
          {slices.length === 1
            ? <circle cx="50" cy="50" r="48" fill={slices[0].color} />
            : slices.map((slice) => <path key={slice.name} d={slice.path} fill={slice.color} stroke="white" strokeWidth="0.7" />)}
        </g>
        <circle cx="50" cy="50" r="28" fill="white" aria-hidden="true" />
        <g aria-hidden="true" className="fill-[#2C4A3E] text-center">
          <text data-chart-total="true" x="50" y="49" textAnchor="middle" dominantBaseline="middle" fontSize={totalFontSize} fontWeight="700">{formattedTotal}</text>
          <text x="50" y="61" textAnchor="middle" dominantBaseline="middle" fontSize="5" fontWeight="500">總份數</text>
        </g>
      </svg>
      <ul aria-label="店家份數明細" className="max-h-72 space-y-3 overflow-y-auto pr-1">
        {slices.map((slice) => <li key={slice.name} className="min-w-0 space-y-1.5 text-sm">
          <div className="flex min-w-0 items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-2">
              <span aria-hidden="true" className="h-3 w-3 shrink-0 rounded-sm" style={{ backgroundColor: slice.color }} />
              <span className="break-words font-medium">{slice.name}</span>
            </span>
            <span className="shrink-0 tabular-nums text-slate-600">{formatCount(slice.portions)} 份 · {slice.percent}%</span>
          </div>
          <div aria-hidden="true" className="ml-5 h-1.5 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full" style={{ width: `${slice.proportion}%`, backgroundColor: slice.color }} />
          </div>
        </li>)}
      </ul>
    </div>
  </section>;
}

function SummaryCard({ label, value }) {
  return <article className="rounded-2xl border border-emerald-100 bg-white p-4 shadow-sm">
    <h3 className="text-sm font-medium text-slate-600">{label}</h3>
    <p className="mt-1 text-2xl font-bold tabular-nums text-[#2C4A3E]">{formatCount(value)}</p>
  </article>;
}

export default function MyBentoFootprintsPage({
  data,
  loading,
  error,
  period,
  onPeriodChange,
  onRefresh,
  isViewAsMode = false
}) {
  const hasOrders = Number(data?.totalPortions || 0) > 0;
  const duplicateItemLabels = new Set();
  const itemIdentitiesByLabel = new Map();
  (Array.isArray(data?.items) ? data.items : []).forEach((item, index) => {
    const key = JSON.stringify([item.name || '', item.vendor || '', item.variantKey || '']);
    if (!itemIdentitiesByLabel.has(key)) itemIdentitiesByLabel.set(key, new Set());
    itemIdentitiesByLabel.get(key).add(item.identityKey || `unverified-item-${index}`);
  });
  itemIdentitiesByLabel.forEach((identities, key) => {
    if (identities.size > 1) duplicateItemLabels.add(key);
  });
  const periodLabel = period === 'year'
    ? `${data?.endDate?.slice(0, 4) || '今年'} 年`
    : period === 'month'
      ? `${data?.endDate?.slice(0, 7) || '本月'}`
      : data?.startDate
        ? `${data.startDate} 至 ${data.endDate}`
        : `全部期間，截至 ${data?.endDate || ''}`;

  return <section aria-label="我的便當足跡" className="space-y-4 pb-6">
    <header className="space-y-3">
      <div>
        <h2 className="text-xl font-bold text-[#2C4A3E]">我的便當足跡</h2>
        {isViewAsMode && <p role="status" className="mt-1 rounded-lg bg-amber-50 p-2 text-sm text-amber-800">目前為唯讀身分檢視，顯示受檢視者的便當足跡。</p>}
        <p className="mt-1 text-sm text-slate-500">{periodLabel}</p>
      </div>
      <div className="grid grid-cols-3 gap-2 rounded-xl bg-slate-100 p-1" role="group" aria-label="統計期間">
        {PERIODS.map(({ value, label }) => <button
          key={value}
          type="button"
          aria-pressed={period === value}
          onClick={() => onPeriodChange(value)}
          className={`min-h-11 rounded-lg px-2 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-emerald-700 ${period === value ? 'bg-white text-emerald-800 shadow-sm' : 'text-slate-600 hover:bg-white/70'}`}
        >{label}</button>)}
      </div>
    </header>

    {loading ? <p role="status" className="rounded-xl bg-white p-4 text-sm text-slate-600">正在整理便當足跡…</p> : null}
    {!loading && error ? <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
      <p>{error}</p>
      <button type="button" onClick={onRefresh} className="mt-2 min-h-11 font-semibold underline">重試</button>
    </div> : null}
    {!loading && !error && !hasOrders ? <p role="status" className="rounded-xl bg-white p-4 text-sm text-slate-600">這段期間還沒有可計入的便當紀錄。</p> : null}

    {!loading && !error && hasOrders ? <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SummaryCard label="累計便當份數" value={data.totalPortions} />
        <SummaryCard label="實際訂購天數" value={data.totalOrderDays} />
        <SummaryCard label="不同餐點種類" value={data.totalMealTypes} />
      </div>

      <VendorDonutChart vendors={data.vendors || []} />

      <section aria-label="餐點份數排行" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="text-base font-bold text-[#2C4A3E]">餐點份數排行</h3>
        <ol className="mt-3 divide-y divide-slate-100">
          {(data.items || []).map((item, index) => <li key={item.identityKey || `${item.vendor || ''}-${item.name}-${item.variantKey || ''}`} className="flex min-h-12 items-center justify-between gap-3 py-2 text-sm">
            <span className="flex min-w-0 items-center gap-3">
              <span className="w-6 shrink-0 text-center font-semibold tabular-nums text-slate-500">{index + 1}</span>
              <span className="min-w-0"><span className="block truncate font-medium text-slate-800">{item.name}</span><span className="block truncate text-xs text-slate-500">{[item.vendor, item.variantKey].filter(Boolean).join(' · ')}</span>{duplicateItemLabels.has(JSON.stringify([item.name || '', item.vendor || '', item.variantKey || ''])) && <span className="block text-xs text-slate-600">品項識別 {item.itemCode || '不同'}</span>}{item.resolved === false && <span className="block text-xs text-amber-800" title={item.resolutionStatus}>身份未確認，原始名稱獨立計算</span>}</span>
            </span>
            <span className="shrink-0 font-semibold tabular-nums text-emerald-800">{formatCount(item.portions)} 份</span>
          </li>)}
        </ol>
      </section>
    </> : null}
  </section>;
}

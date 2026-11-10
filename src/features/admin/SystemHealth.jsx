import React, { useEffect, useState } from 'react';

// The summary is generated at build time (scripts/generate-dependency-health.mjs) and loaded lazily,
// so it is only fetched for an Admin who opens the hub; it adds no API call and no D1 read.
// import.meta.glob tolerates a missing file (e.g. `vite dev` before the first generate).
const loaders = import.meta.glob('../../generated/dependency-health.json');

export function useDependencyHealth(enabled) {
  const [health, setHealth] = useState(null);
  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    const load = Object.values(loaders)[0];
    if (!load) { setHealth({ status: 'unavailable' }); return undefined; }
    load().then((m) => { if (!cancelled) setHealth(m.default || m); })
      .catch(() => { if (!cancelled) setHealth({ status: 'unavailable' }); });
    return () => { cancelled = true; };
  }, [enabled]);
  return health;
}

// Only yellow or red needs attention, so only those show the dot on the hub entry.
export const needsAttention = (health) => health?.status === 'ready' && health.overall !== 'ok';

const STATUS = {
  ok: { icon: '✓', label: '安全且最新', cls: 'bg-emerald-100 text-emerald-800' },
  outdated: { icon: '!', label: '有新版可更新', cls: 'bg-amber-100 text-amber-800' },
  unknown: { icon: '?', label: '無法確認最新版', cls: 'bg-amber-100 text-amber-800' },
  vulnerable: { icon: '✕', label: '有已知漏洞', cls: 'bg-rose-100 text-rose-800' }
};

export default function SystemHealth() {
  const health = useDependencyHealth(true);
  const formatted = health?.generatedAt ? new Date(health.generatedAt).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false }) : '';
  return (
    <section aria-label="系統健康" className="space-y-3">
      <h2 className="text-xl font-bold text-[#2C4A3E]">系統健康</h2>
      {!health && <p className="text-sm text-slate-500">載入中…</p>}
      {health && health.status !== 'ready' && (
        <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
          尚無套件檢查資料。建置或啟動 dev 時會自動產生；也可執行 npm run health:generate。
          {health.reason && <span className="mt-1 block text-xs text-slate-500 break-all">原因：{health.reason}</span>}
        </p>
      )}
      {health?.status === 'ready' && (
        <>
          <p className="text-xs text-slate-500">建置時檢查（npm audit / npm outdated）：{formatted}</p>
          <ul className="space-y-2">
            {health.packages.map((p) => {
              const s = STATUS[p.status] || STATUS.ok;
              return (
                <li key={p.name} className="rounded-xl border border-slate-200 bg-white p-3">
                  <div className="flex items-center gap-3">
                    <span aria-hidden="true" className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-bold ${s.cls}`}>{s.icon}</span>
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold break-all">{p.name}</div>
                      <div className="text-xs text-slate-600">目前 {p.current || '—'} · 最新 {p.latest || '—'}</div>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-1 text-xs font-bold ${s.cls}`}>{s.label}</span>
                  </div>
                  {p.advisories.length > 0 && (
                    <ul className="mt-2 list-disc pl-5 text-xs text-rose-800">
                      {p.advisories.map((a, i) => <li key={`${a.url}-${i}`}>{a.severity ? `[${a.severity}] ` : ''}{a.title}</li>)}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
          {health.otherVulnerable.length > 0 && (
            <p className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
              其他套件有已知漏洞：{health.otherVulnerable.map((v) => `${v.name}${v.severity ? `（${v.severity}）` : ''}`).join('、')}
            </p>
          )}
        </>
      )}
    </section>
  );
}

import React from 'react';

const icons = {
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 3v4M17 3v4M3 10h18" /></>,
  orders: <><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 4.5h6M9 10h6M9 14h6M9 18h4" /></>,
  footprints: <><path d="M4 18.5 9 13l3 2 7-8" /><path d="M14 7h5v5" /><circle cx="5" cy="7" r="1" /><circle cx="19" cy="19" r="1" /></>,
  wallet: <><rect x="3" y="6" width="18" height="15" rx="2" /><path d="M3 10h18M6 6V4h12M16 15h2" /></>,
  management: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1" /></>
};
const entries = [
  { key: 'vendor', label: '店家', icon: 'management' },
  { key: 'calendar', label: '訂餐', icon: 'calendar' },
  { key: 'myOrders', label: '我的訂單', icon: 'orders' },
  { key: 'footprints', label: '足跡', icon: 'footprints' },
  { key: 'wallet', label: '餘額', icon: 'wallet' },
  { key: 'admin', label: '管理', icon: 'management' }
];

export default function BottomNavigation({ current, onNavigate, role, canViewWallet, canManage, balance, balanceKnown = false }) {
  const visible = role === 'Vendor'
    ? entries.filter(({ key }) => key === 'vendor' || key === 'calendar')
    : entries.filter(({ key }) => key !== 'vendor' && (
      key === 'wallet' ? canViewWallet : key === 'admin' ? canManage : true
    ));
  return <nav aria-label="主要導覽" className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 shadow-[0_-2px_12px_rgba(0,0,0,0.05)] backdrop-blur" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
    <div className="mx-auto flex max-w-xl items-stretch">
      {visible.map(({ key, label, icon }) => (
        <button key={key} type="button" onClick={() => onNavigate(key)}
          aria-current={current === key ? 'page' : undefined}
          aria-label={key === 'wallet' ? (balanceKnown ? `餘額 ${balance} 元，查看交易明細` : '餘額讀取中，查看交易明細') : label}
          className={`flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-1 px-1 py-2 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-emerald-700 ${current === key ? 'bg-emerald-50 text-emerald-800' : 'text-slate-600 hover:bg-slate-50'}`}>
          <svg aria-hidden="true" viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{icons[icon]}</svg>
          <span className={key === 'wallet' && balanceKnown && Number(balance) < 0 ? 'text-rose-700 tabular-nums' : 'tabular-nums'}>{key === 'wallet' ? (balanceKnown && Number.isFinite(Number(balance)) ? String(Number(balance)) : '—') : label}</span>
        </button>
      ))}
    </div>
  </nav>;
}

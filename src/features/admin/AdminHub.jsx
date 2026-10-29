import React from 'react';

// Admin landing page: grouped entry points to every management screen.
// `canAuth` checks the signed-in role, not a View-As target, so the menu never changes while previewing.
export default function AdminHub({
  authRole,
  canAuth,
  hasManagementHub,
  showLineNotify,
  effectiveCalendarUi,
  handleAdminSectionChange,
  openAdminCalendar,
  openVendorHub,
  handleOpenViewAs,
  selectCalendarUi
}) {
  return (
      <section aria-label="管理中心" className="space-y-3">
        <h2 className="text-xl font-bold text-[#2C4A3E]">管理中心</h2>
        {showLineNotify && <button type="button" onClick={() => handleAdminSectionChange('lineNotify')} className="w-full min-h-12 rounded-xl border border-slate-200 bg-white px-4 text-left font-semibold">LINE 通知設定 ›</button>}
        {hasManagementHub && (
        <>
        <div className="space-y-2" role="group" aria-label="訂餐管理">
          <h3 className="text-sm font-bold text-[#2C4A3E]">訂餐管理</h3>
        {canAuth('viewAdminOrderSummary') && <button type="button" onClick={() => handleAdminSectionChange('orders')} className="w-full min-h-12 rounded-xl border border-slate-200 bg-white px-4 text-left font-semibold">訂單總覽 ›</button>}
        {canAuth('manageCalendar') && <button type="button" onClick={() => openAdminCalendar()} className="w-full min-h-12 rounded-xl border border-slate-200 bg-white px-4 text-left font-semibold">開團管理 ›</button>}
        {authRole === 'Admin' && <button type="button" onClick={() => handleAdminSectionChange('vendorOperations')} className="w-full min-h-12 rounded-xl border border-slate-200 bg-white px-4 text-left font-semibold">廠商對帳 ›</button>}
        {canAuth('manageAnnouncements') && <button type="button" onClick={() => handleAdminSectionChange('announcements')} className="w-full min-h-12 rounded-xl border border-slate-200 bg-white px-4 text-left font-semibold">公告管理 ›</button>}
        {canAuth('manageMenu') && <button type="button" onClick={() => handleAdminSectionChange('menuChanges')} className="w-full min-h-12 rounded-xl border border-slate-200 bg-white px-4 text-left font-semibold">菜單品項維護 ›</button>}
        <button type="button" onClick={openVendorHub} className="w-full min-h-12 rounded-xl border border-slate-200 bg-white px-4 text-left font-semibold">店家專區 ›</button>
        </div>
        {(canAuth('viewMemberBalances') || (authRole !== 'Admin' && (canAuth('viewAsUser') || canAuth('delegateOrder')))) && (
        <div className="space-y-2" role="group" aria-label="使用者與帳務">
          <h3 className="text-sm font-bold text-[#2C4A3E]">使用者與帳務</h3>
        {canAuth('viewMemberBalances') && <button type="button" onClick={() => handleAdminSectionChange('balances')} className="w-full min-h-12 rounded-xl border border-slate-200 bg-white px-4 text-left font-semibold">使用者管理 ›</button>}
        {authRole !== 'Admin' && canAuth('viewAsUser') && <button type="button" onClick={() => handleOpenViewAs('view')} className="w-full min-h-12 rounded-xl border border-slate-200 bg-white px-4 text-left font-semibold">檢視身分 ›</button>}
        {authRole !== 'Admin' && canAuth('delegateOrder') && <button type="button" onClick={() => handleOpenViewAs('delegate')} className="w-full min-h-12 rounded-xl border border-slate-200 bg-white px-4 text-left font-semibold">選擇代點餐 ›</button>}
        </div>
        )}
        <div className="space-y-2" role="group" aria-label="系統設定">
          <h3 className="text-sm font-bold text-[#2C4A3E]">系統設定</h3>
        <div className="rounded-xl border border-slate-200 bg-white p-4" aria-label="月曆樣式">
          <h3 className="font-semibold text-[#2C4A3E]">月曆樣式</h3>
          <div className="flex gap-2">
            <button type="button" aria-pressed={effectiveCalendarUi === 'classic'} onClick={() => selectCalendarUi('classic')} className={`min-h-11 flex-1 rounded-lg text-sm font-bold ${effectiveCalendarUi === 'classic' ? 'bg-[#2C4A3E] text-white' : 'bg-slate-100 text-slate-700'}`}>經典</button>
            <button type="button" aria-pressed={effectiveCalendarUi === 'modern'} onClick={() => selectCalendarUi('modern')} className={`min-h-11 flex-1 rounded-lg text-sm font-bold ${effectiveCalendarUi === 'modern' ? 'bg-[#2C4A3E] text-white' : 'bg-slate-100 text-slate-700'}`}>極簡</button>
            <button type="button" aria-pressed={effectiveCalendarUi === 'rolling'} onClick={() => selectCalendarUi('rolling')} className={`min-h-11 flex-1 rounded-lg text-sm font-bold ${effectiveCalendarUi === 'rolling' ? 'bg-[#2C4A3E] text-white' : 'bg-slate-100 text-slate-700'}`}>滾動</button>
          </div>
        </div>

        </div>
        </>
        )}
      </section>
  );
}

export default function CalendarManagement({
  currentMonth,
  onPreviousMonth,
  onNextMonth,
  adminManageMode,
  specialAdminDate,
  onSpecialAdminDateChange,
  specialAdminVendorChoice,
  onVendorChange,
  onSaveVendor,
  loading,
  renderCalendarDays,
  weekendEvents
}) {
  return (
    <div className="w-full min-w-0 bg-white rounded-2xl p-4 shadow-sm border border-emerald-900/10 space-y-3">
      <div className="flex justify-between items-center px-1">
        <h2 className="text-lg font-bold text-[#2C4A3E]">
          {currentMonth.getFullYear()} 年 {currentMonth.getMonth() + 1} 月
        </h2>
        <div className="flex gap-1 items-center">
          <button
            onClick={onPreviousMonth}
            className="p-1.5 hover:bg-gray-100 rounded-lg text-sm"
          >
            ◀
          </button>
          <button
            onClick={onNextMonth}
            className="p-1.5 hover:bg-gray-100 rounded-lg text-sm"
          >
            ▶
          </button>
        </div>
      </div>

      {adminManageMode && (
        <div className="bg-rose-50 border border-rose-200 p-3 rounded-xl text-xs text-rose-800 space-y-3">
          <p className="font-medium">🛠️ 管理者模式啟用中：點擊月曆日期可編輯該日開團設定。</p>
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2 items-end">
            <div>
              <label className="block font-bold mb-1" htmlFor="calendar-special-date">指定日期</label>
              <input
                id="calendar-special-date"
                type="date"
                value={specialAdminDate}
                onChange={(e) => onSpecialAdminDateChange(e.target.value)}
                className="w-full min-w-0 border border-rose-200 rounded-xl p-2.5 bg-white text-sm focus:outline-rose-500"
              />
            </div>
            <div>
              <label className="block font-bold mb-1" htmlFor="calendar-special-vendor">店家</label>
              <select
                id="calendar-special-vendor"
                value={specialAdminVendorChoice}
                onChange={(e) => onVendorChange(e.target.value)}
                className="w-full min-w-0 border border-rose-200 rounded-xl p-2.5 bg-white text-sm focus:outline-rose-500"
              >
                <option value="蔡老師">蔡老師</option>
                <option value="禾拾">禾拾</option>
                <option value="合十">合十</option>
                <option value="">不開團</option>
              </select>
            </div>
            <button
              type="button"
              onClick={onSaveVendor}
              disabled={!specialAdminDate || loading}
              className="bg-[#2C4A3E] text-white px-3 py-2.5 rounded-xl font-bold hover:bg-emerald-800 disabled:bg-gray-300 whitespace-nowrap"
            >
              儲存設定
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-5 gap-1 text-center font-medium text-xs text-gray-500 mb-1">
        <div>一</div><div>二</div><div>三</div><div>四</div><div>五</div>
      </div>

      <div className="grid grid-cols-5 gap-1.5">
        {renderCalendarDays()}
      </div>

      {weekendEvents.length > 0 && (
        <div className="border-t border-emerald-100 pt-3 space-y-2">
          <h3 className="font-bold text-sm text-[#2C4A3E]">週末特別開團</h3>
          <div className="space-y-2">
            {weekendEvents}
          </div>
        </div>
      )}
    </div>
  );
}

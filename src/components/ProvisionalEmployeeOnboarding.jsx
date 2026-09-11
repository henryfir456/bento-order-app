export default function ProvisionalEmployeeOnboarding({
  employeeId,
  lineDisplayName = '',
  displayName,
  onDisplayNameChange,
  pickupFloor,
  onPickupFloorChange,
  onSubmit,
  loading = false,
  error = '',
  success = '',
  bound = false,
  profileCompleted = false,
  lineAuthenticated = false
}) {
  const hasCanonicalProfile = bound || profileCompleted;

  return (
    <section
      aria-label="員工 onboarding"
      className="mb-4 rounded-3xl border border-emerald-900/10 bg-white p-6 shadow-sm"
    >
      <div className="space-y-2 text-center">
        <div className="text-4xl">🍱</div>
        <h2 className="text-xl font-bold text-[#2C4A3E]">
          {bound ? 'LINE 綁定完成' : hasCanonicalProfile ? '基本資料已建立' : '完成員工 onboarding'}
        </h2>
        {hasCanonicalProfile ? (
          <>
            <p className="text-sm font-bold text-amber-700">員工身分待核驗</p>
            <p className="text-sm text-gray-500">您的基本資料已建立，目前正在等待員工身分核驗。核驗完成後即可使用訂餐功能。</p>
          </>
        ) : (
          <p className="text-sm text-gray-500">
            員工編號 <span className="font-bold text-gray-700">{employeeId}</span> 尚未完成核驗，
            {lineAuthenticated
              ? '請先確認基本資料並完成 LINE onboarding。'
              : '請先確認基本資料並完成 onboarding。'}
          </p>
        )}
        {lineDisplayName && (
          <p className="text-xs text-gray-400">已驗證的 LINE 顯示名稱：{lineDisplayName}</p>
        )}
      </div>

      <form onSubmit={onSubmit} className="mt-5 space-y-3">
        <label htmlFor="provisional-display-name" className="block text-sm font-medium text-gray-600">
          顯示名稱
        </label>
        <input
          id="provisional-display-name"
          type="text"
          value={displayName}
          onChange={(event) => onDisplayNameChange(event.target.value)}
          maxLength={100}
          disabled={loading}
          className="w-full rounded-2xl border border-gray-200 px-4 py-3 text-base text-gray-800 outline-none transition focus:border-emerald-700 focus:ring-2 focus:ring-emerald-100 disabled:bg-gray-50"
        />

        <label htmlFor="provisional-pickup-floor" className="block text-sm font-medium text-gray-600">
          預設領取樓層
        </label>
        <select
          id="provisional-pickup-floor"
          value={pickupFloor}
          onChange={(event) => onPickupFloorChange(event.target.value)}
          disabled={loading}
          className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-base text-gray-800 outline-none transition focus:border-emerald-700 focus:ring-2 focus:ring-emerald-100 disabled:bg-gray-50"
        >
          <option value="1樓">1樓</option>
          <option value="9樓">9樓</option>
        </select>

        <button
          type="submit"
          disabled={loading || !displayName.trim() || !pickupFloor}
          className="w-full rounded-2xl bg-[#2C4A3E] py-3.5 text-sm font-bold text-white shadow-md transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-gray-300"
        >
          {loading
            ? (hasCanonicalProfile
              ? '儲存中...'
              : (lineAuthenticated ? '建立 onboarding 並綁定中...' : '建立 onboarding 中...'))
            : (hasCanonicalProfile
              ? '更新基本資料'
              : (lineAuthenticated ? '完成 onboarding 並綁定 LINE' : '完成 onboarding'))}
        </button>
        {error && (
          <p role="alert" className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {error}
          </p>
        )}
        {success && (
          <p role="status" aria-live="polite" className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {success}
          </p>
        )}
      </form>
    </section>
  );
}

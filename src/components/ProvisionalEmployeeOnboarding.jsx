export default function ProvisionalEmployeeOnboarding({
  employeeId,
  displayName,
  onDisplayNameChange,
  pickupFloor,
  onPickupFloorChange,
  onSubmit,
  loading = false,
  error = '',
  success = ''
}) {
  return (
    <section
      aria-label="員工 onboarding"
      className="mb-4 rounded-3xl border border-emerald-900/10 bg-white p-6 shadow-sm"
    >
      <div className="space-y-2 text-center">
        <div className="text-4xl">🍱</div>
        <h2 className="text-xl font-bold text-[#2C4A3E]">
          完成員工 onboarding
        </h2>
        <p className="text-sm text-gray-500">
          員工編號 <span className="font-bold text-gray-700">{employeeId}</span> 尚未建立員工資料，
          請完成基本資料後開始使用員工訪客功能。
        </p>
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
          <option value="">請選擇樓層</option>
          <option value="1樓">1樓</option>
          <option value="9樓">9樓</option>
        </select>

        <button
          type="submit"
          disabled={loading || !displayName.trim() || !pickupFloor}
          className="w-full rounded-2xl bg-[#2C4A3E] py-3.5 text-sm font-bold text-white shadow-md transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-gray-300"
        >
          {loading
            ? '建立 onboarding 中...'
            : '完成 onboarding'}
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

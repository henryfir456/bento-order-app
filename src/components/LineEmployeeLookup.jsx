export default function LineEmployeeLookup({
  employeeId,
  onEmployeeIdChange,
  onSubmit,
  loading = false,
  error = '',
  bindingRequired = false
}) {
  return (
    <section
      aria-label="LINE 綁定員編"
      className="mb-4 rounded-3xl border border-emerald-900/10 bg-white p-6 shadow-sm"
    >
      <div className="space-y-2 text-center">
        <div className="text-4xl">🔗</div>
        <h2 className="text-xl font-bold text-[#2C4A3E]">
          {bindingRequired ? 'LINE 綁定員編' : '完成 LINE 綁定'}
        </h2>
        <p className="text-sm text-gray-500">
          {bindingRequired
            ? '目前 LINE 身份尚未綁定員編，請輸入員工編號完成綁定。Worker 會安全處理既有暫存員工身份。'
            : '請輸入員工編號完成 LINE 綁定；Worker 會處理新綁定、既有 ownership 與暫存員工 claim。'}
        </p>
      </div>

      <form onSubmit={onSubmit} className="mt-5 space-y-2">
        <label htmlFor="line-employee-lookup-id" className="block text-sm font-medium text-gray-600">
          6 碼員工編號
        </label>
        <input
          id="line-employee-lookup-id"
          name="employeeId"
          type="text"
          inputMode="text"
          autoComplete="off"
          maxLength={6}
          pattern="[A-Za-z0-9]{6}"
          value={employeeId}
          onChange={(event) => onEmployeeIdChange(event.target.value)}
          placeholder="例如 001234"
          disabled={loading}
          className="w-full rounded-2xl border border-gray-200 px-4 py-3 text-base text-gray-800 outline-none transition focus:border-emerald-700 focus:ring-2 focus:ring-emerald-100 disabled:bg-gray-50"
        />
        <button
          type="submit"
          disabled={loading || !employeeId.trim()}
          className="w-full rounded-2xl bg-[#2C4A3E] py-3.5 text-sm font-bold text-white shadow-md transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-gray-300"
        >
          {loading ? '綁定中...' : (bindingRequired ? '綁定員編' : '綁定 LINE 與員編')}
        </button>
        {error && (
          <p role="alert" className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {error}
          </p>
        )}
      </form>
    </section>
  );
}

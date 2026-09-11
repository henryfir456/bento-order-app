import { useState } from 'react';

export default function EmployeeGuestLogin({
  employeeId,
  onEmployeeIdChange,
  onEmployeeSubmit,
  onLineLogin,
  loading = false,
  error = ''
}) {
  const [employeeFallbackOpen, setEmployeeFallbackOpen] = useState(Boolean(error));

  return (
    <section
      aria-label="員工登入"
      className="mb-4 rounded-3xl border border-emerald-900/10 bg-white p-6 shadow-sm"
    >
      <div className="space-y-2 text-center">
        <div className="text-4xl">🍱</div>
        <h2 className="text-xl font-bold text-[#2C4A3E]">員工登入</h2>
        <p className="text-sm text-gray-500">
          請優先使用 LINE 登入；若目前無法使用 LINE，可從其他登入方式進入員工流程。
        </p>
      </div>

      <div className="mt-5 space-y-3">
        <button
          type="button"
          onClick={onLineLogin}
          disabled={loading}
          className="w-full rounded-2xl border border-[#2C4A3E] bg-[#2C4A3E] py-3.5 text-sm font-bold text-white shadow-md transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-gray-300"
        >
          {loading ? '處理中...' : '使用 LINE 登入'}
        </button>

        <details
          open={employeeFallbackOpen}
          onToggle={(event) => setEmployeeFallbackOpen(event.currentTarget.open)}
          className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3"
        >
          <summary className="cursor-pointer text-sm font-bold text-emerald-900">
            其他登入方式
          </summary>
          <p className="mt-2 text-xs text-gray-500">
            員編登入僅是沒有 LINE 身份時的 bootstrap/fallback；若此員編已綁定 LINE，伺服器仍會要求改用 LINE 登入。
          </p>
          <div className="mt-3">
            {employeeFallbackOpen && (
              <EmployeeIdForm
                employeeId={employeeId}
                onEmployeeIdChange={onEmployeeIdChange}
                onEmployeeSubmit={onEmployeeSubmit}
                loading={loading}
              />
            )}
          </div>
        </details>

        {error && (
          <p role="alert" className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}

function EmployeeIdForm({
  employeeId,
  onEmployeeIdChange,
  onEmployeeSubmit,
  loading
}) {
  return (
    <form onSubmit={onEmployeeSubmit} className="space-y-2">
      <label htmlFor="employee-guest-id" className="block text-sm font-medium text-gray-600">
        員工編號
      </label>
      <input
        id="employee-guest-id"
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
        className="w-full rounded-2xl border border-emerald-800 bg-white py-3 text-sm font-bold text-emerald-900 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-400"
      >
        {loading ? '登入中...' : '以員工編號登入'}
      </button>
    </form>
  );
}

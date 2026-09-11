export default function EmployeeIdentityConfirmation({
  employeeId,
  user,
  onConfirm,
  onCancel,
  loading = false,
  error = ''
}) {
  return (
    <section
      aria-label="確認員工身份"
      className="mb-4 rounded-3xl border border-emerald-900/10 bg-white p-6 shadow-sm"
    >
      <div className="space-y-2 text-center">
        <div className="text-4xl">🔗</div>
        <h2 className="text-xl font-bold text-[#2C4A3E]">確認員工身份</h2>
        <p className="text-sm text-gray-500">
          請確認以下資料是你的員工資料，確認後會將目前 LINE 帳號綁定到此員工編號。
        </p>
      </div>

      <dl className="mt-5 space-y-2 rounded-2xl bg-emerald-50 p-4 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-gray-500">員工編號</dt>
          <dd className="font-bold text-gray-800">{employeeId}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-gray-500">姓名</dt>
          <dd className="font-bold text-gray-800">{user?.name || '—'}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-gray-500">領取樓層</dt>
          <dd className="font-bold text-gray-800">{user?.floor || '—'}</dd>
        </div>
      </dl>

      <div className="mt-5 space-y-2">
        <button
          type="button"
          onClick={onConfirm}
          disabled={loading}
          className="w-full rounded-2xl bg-[#2C4A3E] py-3.5 text-sm font-bold text-white shadow-md transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-gray-300"
        >
          {loading ? '綁定中...' : '確認並綁定 LINE'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={loading}
          className="w-full rounded-2xl border border-gray-200 bg-white py-3 text-sm font-bold text-gray-600 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-300"
        >
          返回
        </button>
        {error && (
          <p role="alert" className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}

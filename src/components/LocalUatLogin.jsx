import { useState } from 'react';

const TEST_ROLES = Object.freeze([
  { value: 'admin', label: 'Admin（管理員）' },
  { value: 'user', label: 'User（訂餐者）' },
  { value: 'vendor-one', label: `Vendor V${String(1).padStart(5, '0')}（主要測試店家）` },
  { value: 'vendor-two', label: `Vendor V${String(2).padStart(5, '0')}（隔離測試店家）` }
]);

export default function LocalUatLogin({ onLogin, initialError = '' }) {
  const [role, setRole] = useState('admin');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(initialError);
  const [loading, setLoading] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    if (loading) return;
    setLoading(true);
    setError('');
    try {
      await onLogin({ role, password });
    } catch (failure) {
      const code = String(failure?.code || failure?.message || 'LOCAL_UAT_LOGIN_FAILED');
      const requestId = String(failure?.requestId || '').trim();
      setError(requestId ? `${code}（追蹤碼 ${requestId}）` : code);
      setLoading(false);
    }
  };

  return (
    <section
      aria-label="隔離測試環境登入"
      className="mx-auto mb-4 max-w-lg rounded-3xl border border-emerald-900/10 bg-white p-6 shadow-sm"
    >
      <div className="space-y-2 text-center">
        <div className="text-4xl">🧪</div>
        <h2 className="text-xl font-bold text-[#2C4A3E]">隔離 Worker 測試環境</h2>
        <p className="text-sm text-gray-600">
          請使用本機 UAT 憑證。此登入會呼叫隔離 Worker API，不使用正式帳號或 Mock 資料。
        </p>
      </div>

      <form className="mt-5 space-y-3" onSubmit={submit}>
        <label className="block space-y-1 text-sm font-semibold text-gray-700">
          <span>測試身份</span>
          <select
            aria-label="測試身份"
            autoComplete="off"
            value={role}
            onChange={(event) => setRole(event.target.value)}
            className="w-full rounded-xl border border-gray-300 bg-white px-3 py-3 text-base"
          >
            {TEST_ROLES.map((item) => (
              <option key={item.value} value={item.value}>{item.label}</option>
            ))}
          </select>
        </label>
        <label className="block space-y-1 text-sm font-semibold text-gray-700">
          <span>本機測試密碼</span>
          <input
            aria-label="本機測試密碼"
            autoComplete="current-password"
            type="password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="w-full rounded-xl border border-gray-300 px-3 py-3 text-base"
          />
        </label>
        {error && (
          <p role="alert" className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={loading || !password}
          className="w-full rounded-2xl bg-[#2C4A3E] py-3.5 text-sm font-bold text-white shadow-md transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-gray-300"
        >
          {loading ? '驗證中…' : '登入隔離測試環境'}
        </button>
      </form>
      <p className="mt-4 text-center text-xs leading-5 text-gray-500">
        測試帳號與密碼由 Windows 啟動器產生，僅保存在本機忽略檔案中。
      </p>
    </section>
  );
}

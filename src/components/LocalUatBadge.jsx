export default function LocalUatBadge({ mode, role, onSwitch }) {
  if (!import.meta.env.DEV || mode !== 'local-uat') return null;
  return (
    <button
      type="button"
      onClick={onSwitch}
      className="rounded bg-lime-200 px-1.5 py-1 text-[10px] font-extrabold tracking-wide text-lime-950 hover:bg-lime-100"
      aria-label="切換隔離測試帳號"
      title="登出目前測試身份並切換角色"
    >
      LOCAL API · {String(role || '未登入').toUpperCase()} · 切換
    </button>
  );
}

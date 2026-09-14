import { formatBalanceAmount } from '../features/balances/formatters';

export default function ViewAsBanner({
  viewAsUser,
  delegatedOrderUser,
  authUser,
  displayBalance,
  onExit,
  onExitDelegated
}) {
  if (delegatedOrderUser) {
    return (
      <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border-2 border-sky-300 bg-sky-50 px-3 py-2 text-xs font-bold text-sky-950">
        <span>
          🍱 {authUser?.name || '目前登入者'} 正在代替 {delegatedOrderUser.name || '使用者'}（{delegatedOrderUser.role || 'User'}）點餐
          ・目標餘額：{formatBalanceAmount(delegatedOrderUser.balance)}
        </span>
        <button
          type="button"
          onClick={onExitDelegated}
          className="rounded-lg bg-[#2C4A3E] px-2.5 py-1.5 text-white shadow-sm"
        >
          結束代點
        </button>
      </div>
    );
  }

  if (!viewAsUser) return null;

  return (
    <>
      <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-900">
        預覽餘額：{formatBalanceAmount(displayBalance)}（僅供介面預覽）
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border-2 border-amber-300 bg-amber-100 px-3 py-2 text-xs font-bold text-amber-950">
        <span>👁 正以 {viewAsUser.name}（{viewAsUser.role}）身分檢視</span>
        <button
          type="button"
          onClick={onExit}
          className="rounded-lg bg-[#2C4A3E] px-2.5 py-1.5 text-white shadow-sm"
        >
          返回 Admin
        </button>
      </div>
    </>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { apiClient } from '../../api/apiClient';
import { formatDateTime, getTaipeiYearMonth } from '../../dateUtils';
import { formatBalanceAmount } from './formatters';
import { formatEmployeeId } from '../../components/userIdentityDisplay';
import IdentityStatusBadges from '../../components/IdentityStatusBadges';
import { filterMembersByEmployeeId } from '../admin/delegateOrderFilter.js';
import {
  getAdminMemberRows,
  isEligibleEmployeeBindingTarget
} from './identityStatus';

const memberKey = (user, index) => user.userId || `member-${index}`;

const BalanceBadge = ({ balance }) => (
  <span className={`font-bold px-1.5 py-0.5 rounded text-xs ${balance < 0
    ? 'bg-red-50 text-red-600 border border-red-200'
    : 'bg-emerald-50 text-emerald-800 border border-emerald-200'}`}>
    {formatBalanceAmount(balance)}
  </span>
);

const MemberAction = ({ user, canTopup, canBindEmployee, isViewAsMode, onOpenTopupModal, onOpenEmployeeBindModal }) => {
  if (isViewAsMode) return <span className="text-gray-400">—</span>;
  const actions = [];
  if (canBindEmployee && isEligibleEmployeeBindingTarget(user)) {
    actions.push(
      <button
        key="bind"
        type="button"
        onClick={() => onOpenEmployeeBindModal(user)}
        className="bg-amber-600 hover:bg-amber-500 text-white px-2.5 py-1.5 rounded-lg text-xs font-bold transition shadow-sm whitespace-nowrap"
      >
        綁員編
      </button>
    );
  }
  if (canTopup && user.userId) {
    actions.push(
      <button
        key="topup"
        type="button"
        onClick={() => onOpenTopupModal(user)}
        className="bg-emerald-700 hover:bg-emerald-600 text-white px-2.5 py-1.5 rounded-lg text-xs font-bold transition shadow-sm whitespace-nowrap"
      >
        儲值
      </button>
    );
  }
  return actions.length > 0
    ? <div className="flex max-w-full flex-wrap gap-1">{actions}</div>
    : <span className="text-gray-400">—</span>;
};

const MemberIdentity = ({ user }) => (
  <div className="min-w-0 space-y-1">
    <div className="truncate font-medium">{user.name || '未命名使用者'}</div>
    <div className="flex min-w-0 flex-wrap items-center gap-1 text-[11px] text-gray-500">
      <span className="whitespace-nowrap">員編 {formatEmployeeId(user.employeeId)}</span>
      <IdentityStatusBadges fields={['lineBinding']} lineBound={user.lineBound} lineUserId={user.lineUserId} />
    </div>
  </div>
);

export default function MemberBalanceManagement({
  memberBalances,
  memberBalancesLoading,
  memberBalancesError,
  canTopup,
  canBindEmployee,
  isViewAsMode,
  onOpenTopupModal,
  onOpenEmployeeBindModal,
  canViewAsUser = false,
  canDelegateOrder = false,
  onViewAsUser,
  onDelegateOrderUser
}) {
  const [sort, setSort] = useState({ key: 'balance', direction: 'asc' });
  const toggleSort = (key) => setSort(current => ({ key, direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc' }));
  const SortHeading = ({ field, children }) => <button type="button" className="flex items-center gap-1 whitespace-nowrap font-bold hover:text-emerald-700" onClick={() => toggleSort(field)} aria-label={`${children}排序`} aria-pressed={sort.key === field}>{children}<span aria-hidden="true">{sort.key === field ? (sort.direction === 'asc' ? '↑' : '↓') : '↕'}</span></button>;
  const [employeeIdFilter, setEmployeeIdFilter] = useState('');
  const [selectedUser, setSelectedUser] = useState(null);
  const [month, setMonth] = useState(() => { const { year, month } = getTaipeiYearMonth(); return `${year}-${String(month).padStart(2, '0')}`; });
  const [ledger, setLedger] = useState(null);
  const [ledgerError, setLedgerError] = useState('');
  const [ledgerLoading, setLedgerLoading] = useState(false);
  useEffect(() => {
    if (!selectedUser?.userId || isViewAsMode) return undefined;
    let active = true;
    setLedger(null);
    setLedgerError('');
    setLedgerLoading(true);
    apiClient.getAdminUserLedger({ userId: selectedUser.userId, month })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok || data?.success === false) throw new Error(data?.error || '讀取交易明細失敗');
        if (active) setLedger(data);
      })
      .catch(() => { if (active) setLedgerError('無法取得交易紀錄，請確認管理權限或稍後重試。'); })
      .finally(() => { if (active) setLedgerLoading(false); });
    return () => { active = false; };
  }, [selectedUser, month, isViewAsMode]);
  const adminMembers = useMemo(() => getAdminMemberRows(memberBalances), [memberBalances]);
  const filteredMembers = useMemo(() => {
    const searched = filterMembersByEmployeeId(adminMembers, employeeIdFilter);
    return [...searched].sort((a, b) => {
      const numeric = sort.key === 'balance';
      const difference = numeric
        ? (Number(a.balance) || 0) - (Number(b.balance) || 0)
        : String(a[sort.key] ?? '').localeCompare(String(b[sort.key] ?? ''), 'zh-TW', { numeric: true });
      return (sort.direction === 'asc' ? difference : -difference)
        || String(a.employeeId ?? '').localeCompare(String(b.employeeId ?? ''), 'zh-TW', { numeric: true });
    });
  }, [adminMembers, employeeIdFilter, sort]);
  const hasActions = !isViewAsMode && (canTopup || canBindEmployee || canViewAsUser || canDelegateOrder);
  const UserNavigationActions = ({ user }) => isViewAsMode ? null : <div className="flex flex-wrap gap-1">
    {canViewAsUser && <button type="button" onClick={() => onViewAsUser(user)} className="rounded-lg bg-slate-700 px-2 py-1.5 text-xs font-bold text-white">👁 檢視身分</button>}
    {canDelegateOrder && <button type="button" onClick={() => onDelegateOrderUser(user)} className="rounded-lg bg-sky-700 px-2 py-1.5 text-xs font-bold text-white">🍱 代點餐</button>}
  </div>;

  return (
    <div className="space-y-4">
      <div className="bg-white p-4 rounded-2xl shadow-sm border border-emerald-900/10 space-y-3">
        <div>
          <h3 className="font-bold text-base text-[#2C4A3E]">👥 使用者管理中心</h3>
          <p className="text-xs text-gray-500">統一搜尋使用者、查詢餘額與交易紀錄，並依管理權限檢視身分、代點餐或儲值；所有操作沿用既有授權規則。</p>
        </div>
        <label className="block max-w-sm">
          <span className="sr-only">搜尋員編</span>
          <input
            type="search"
            inputMode="search"
            value={employeeIdFilter}
            onChange={(event) => setEmployeeIdFilter(event.target.value)}
            placeholder="搜尋員編"
            aria-label="搜尋員編"
            className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-800 outline-none transition focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-100"
          />
        </label>
        <p className="text-xs text-gray-500">預設依餘額由小到大排序，點選表格標題可切換排序。</p>
      </div>

      {selectedUser && !isViewAsMode && <section className="rounded-2xl border border-emerald-200 bg-white p-4 space-y-3" aria-label="使用者交易明細">
        <div className="flex items-start justify-between gap-3"><div><h3 className="font-bold">{selectedUser.name || '使用者'}｜交易明細</h3><p className="text-xs text-gray-500">員編 {formatEmployeeId(selectedUser.employeeId)} · 目前名單餘額 {formatBalanceAmount(selectedUser.balance)}</p></div><button type="button" onClick={() => setSelectedUser(null)} aria-label="關閉交易明細">✕</button></div>
        <label className="block text-sm">交易月份 <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="ml-2 rounded border p-1" /></label>
        {ledgerLoading ? <p role="status">讀取交易明細中…</p> : ledgerError ? <p role="alert" className="text-red-700">{ledgerError}</p> : ledger && <>
          <div className="grid grid-cols-2 gap-2 text-sm"><div>期初餘額：{formatBalanceAmount(ledger.openingBalance)}</div><div>當月期末：{formatBalanceAmount(ledger.closingBalance)}</div><div>當月入帳：+{formatBalanceAmount(ledger.totalCredit)}</div><div>當月扣款：-{formatBalanceAmount(ledger.totalDebit)}</div></div>
          {ledger.reconciliation?.status && ledger.reconciliation.status !== 'CONSISTENT' && <p role="alert" className="text-amber-800">交易帳務存在需檢查的差異，請勿自行調整餘額。</p>}
          {ledger.transactions?.length ? <div className="max-h-96 overflow-y-auto space-y-2">{ledger.transactions.map(tx => <div key={tx.transactionId} className="border-t py-2 text-sm"><div className="flex justify-between gap-2"><span>{tx.description || tx.type}</span><strong>{tx.amount > 0 ? '+' : ''}{formatBalanceAmount(tx.amount)}</strong></div><div className="flex flex-wrap justify-between text-xs text-gray-500 gap-2"><span>{formatDateTime(tx.occurredAt)}</span><span>交易後餘額 {formatBalanceAmount(tx.balanceAfter)}</span></div></div>)}</div> : <p className="text-sm text-gray-500">該月份沒有交易明細。</p>}
        </>}
      </section>}
      {memberBalancesLoading ? (
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-emerald-900/10 text-center text-sm text-emerald-800 animate-pulse">
          讀取成員餘額中...
        </div>
      ) : memberBalancesError ? (
        <div className="bg-rose-50 p-4 rounded-2xl border border-rose-200 text-center text-sm text-rose-800">
          {memberBalancesError}
        </div>
      ) : filteredMembers.length === 0 ? (
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-emerald-900/10 text-center text-sm text-gray-400">
          {adminMembers.length === 0 ? '目前沒有成員餘額資料' : '目前員編搜尋沒有符合的成員'}
        </div>
      ) : (
        <div className="bg-white p-4 rounded-2xl shadow-sm border border-emerald-900/10">
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-gray-100 text-gray-600">
                <tr>
                  <th className="p-2"><SortHeading field="name">姓名</SortHeading></th>
                  <th className="p-2 whitespace-nowrap">LINE 綁定</th>
                  <th className="p-2 whitespace-nowrap"><SortHeading field="employeeId">員編</SortHeading></th>
                  <th className="p-2 whitespace-nowrap"><SortHeading field="floor">樓層</SortHeading></th>
                  <th className="p-2 whitespace-nowrap" aria-sort={sort.key === "balance" ? (sort.direction === "asc" ? "ascending" : "descending") : undefined}><SortHeading field="balance">餘額</SortHeading></th>
                  <th className="p-2 whitespace-nowrap"><SortHeading field="role">角色</SortHeading></th>
                  {hasActions && <th className="p-2 whitespace-nowrap">操作</th>}
                  {!isViewAsMode && <th className="p-2">交易</th>}
                </tr>
              </thead>
              <tbody>
                {filteredMembers.map((user, idx) => (
                  <tr key={memberKey(user, idx)} className="border-b last:border-0">
                    <td className="p-2 font-medium">{user.name || '未命名使用者'}</td>
                    <td className="p-2"><IdentityStatusBadges fields={['lineBinding']} lineBound={user.lineBound} lineUserId={user.lineUserId} /></td>
                    <td className="p-2 whitespace-nowrap">{formatEmployeeId(user.employeeId)}</td>
                    <td className="p-2 whitespace-nowrap">{user.floor || '未設定'}</td>
                    <td className="p-2"><BalanceBadge balance={user.balance} /></td>
                    <td className="p-2 whitespace-nowrap">{user.role || 'User'}</td>
                    {hasActions && <td className="p-2 space-y-1"><UserNavigationActions user={user} /><MemberAction {...{ user, canTopup, canBindEmployee, isViewAsMode, onOpenTopupModal, onOpenEmployeeBindModal }} /></td>}
                    {!isViewAsMode && <td className="p-2"><button type="button" className="text-emerald-800 underline" onClick={() => setSelectedUser(user)}>明細</button></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-2 md:hidden">
            {filteredMembers.map((user, idx) => (
              <article key={memberKey(user, idx)} className="rounded-2xl border border-gray-100 bg-gray-50 p-3 space-y-2">
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <MemberIdentity user={user} />
                  {hasActions && <div className="flex flex-col gap-1"><UserNavigationActions user={user} /><MemberAction {...{ user, canTopup, canBindEmployee, isViewAsMode, onOpenTopupModal, onOpenEmployeeBindModal }} /></div>}
                </div>
                {!isViewAsMode && <button type="button" className="text-sm font-bold text-emerald-800 underline" onClick={() => setSelectedUser(user)}>檢視交易明細</button>}
                <div className="grid grid-cols-3 gap-2 text-xs text-gray-600">
                  <div><div className="text-[10px] text-gray-400">樓層</div><div className="truncate">{user.floor || '未設定'}</div></div>
                  <div><div className="text-[10px] text-gray-400">餘額</div><BalanceBadge balance={user.balance} /></div>
                  <div><div className="text-[10px] text-gray-400">角色</div><div className="truncate">{user.role || 'User'}</div></div>
                </div>
              </article>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

import { useMemo, useState } from 'react';
import { formatBalanceAmount } from './formatters';
import { formatEmployeeId } from '../../components/userIdentityDisplay';
import IdentityStatusBadges from '../../components/IdentityStatusBadges';
import {
  identityFilterMatches,
  identityFilterOptions,
  IDENTITY_FILTERS
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
  if (canBindEmployee && !user.employeeId && user.userId) {
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
      <IdentityStatusBadges authSource={user.authSource} identityState={user.identityState} />
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
  onOpenEmployeeBindModal
}) {
  const [identityFilter, setIdentityFilter] = useState(IDENTITY_FILTERS.ALL);
  const filteredMembers = useMemo(() => (
    memberBalances.filter((member) => identityFilterMatches(member, identityFilter))
  ), [memberBalances, identityFilter]);
  const hasActions = !isViewAsMode && (canTopup || canBindEmployee);

  return (
    <div className="space-y-4">
      <div className="bg-white p-4 rounded-2xl shadow-sm border border-emerald-900/10 space-y-3">
        <div>
          <h3 className="font-bold text-base text-[#2C4A3E]">💰 餘額與身份管理</h3>
          <p className="text-xs text-gray-500">身份來源與狀態以 Worker authoritative response 為準；餘額為目前帳戶總額。</p>
        </div>
        <div className="flex max-w-full flex-wrap gap-2" role="group" aria-label="身份狀態篩選">
          {identityFilterOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setIdentityFilter(option.value)}
              aria-pressed={identityFilter === option.value}
              className={`rounded-full border px-3 py-1.5 text-xs font-bold whitespace-nowrap transition ${identityFilter === option.value
                ? 'border-emerald-700 bg-emerald-700 text-white'
                : 'border-gray-200 bg-gray-50 text-gray-600 hover:border-emerald-300 hover:bg-emerald-50'}`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

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
          {memberBalances.length === 0 ? '目前沒有成員餘額資料' : '目前篩選條件沒有符合的成員'}
        </div>
      ) : (
        <div className="bg-white p-4 rounded-2xl shadow-sm border border-emerald-900/10">
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-gray-100 text-gray-600">
                <tr>
                  <th className="p-2">姓名</th>
                  <th className="p-2 whitespace-nowrap">登入來源</th>
                  <th className="p-2 whitespace-nowrap">身份狀態</th>
                  <th className="p-2 whitespace-nowrap">員編</th>
                  <th className="p-2 whitespace-nowrap">樓層</th>
                  <th className="p-2 whitespace-nowrap">餘額</th>
                  <th className="p-2 whitespace-nowrap">角色</th>
                  {hasActions && <th className="p-2 whitespace-nowrap">操作</th>}
                </tr>
              </thead>
              <tbody>
                {filteredMembers.map((user, idx) => (
                  <tr key={memberKey(user, idx)} className="border-b last:border-0">
                    <td className="p-2 font-medium">{user.name || '未命名使用者'}</td>
                    <td className="p-2"><IdentityStatusBadges fields={['authSource']} authSource={user.authSource} identityState={user.identityState} /></td>
                    <td className="p-2"><IdentityStatusBadges fields={['identityState']} authSource={user.authSource} identityState={user.identityState} /></td>
                    <td className="p-2 whitespace-nowrap">{formatEmployeeId(user.employeeId)}</td>
                    <td className="p-2 whitespace-nowrap">{user.floor || '未設定'}</td>
                    <td className="p-2"><BalanceBadge balance={user.balance} /></td>
                    <td className="p-2 whitespace-nowrap">{user.role || 'User'}</td>
                    {hasActions && <td className="p-2"><MemberAction {...{ user, canTopup, canBindEmployee, isViewAsMode, onOpenTopupModal, onOpenEmployeeBindModal }} /></td>}
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
                  {hasActions && <MemberAction {...{ user, canTopup, canBindEmployee, isViewAsMode, onOpenTopupModal, onOpenEmployeeBindModal }} />}
                </div>
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

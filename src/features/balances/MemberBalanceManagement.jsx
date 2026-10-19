import { useEffect, useMemo, useState } from 'react';
import { apiClient } from '../../api/apiClient';
import { formatDateTime, getTaipeiYearMonth } from '../../dateUtils';
import { formatBalanceAmount } from './formatters';
import { formatEmployeeId } from '../../components/userIdentityDisplay';
import IdentityStatusBadges from '../../components/IdentityStatusBadges';
import { filterMembersByEmployeeId } from '../admin/delegateOrderFilter.js';
import { getLineBindingTransferMessage } from './lineBindingTransferMessages.js';
import { getInvalidEmployeeRepairMessage } from './invalidEmployeeRepairMessages.js';
import {
  getAdminMemberRows,
  isActiveValidMember,
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
  if (isViewAsMode || !isActiveValidMember(user)) return <span className="text-gray-400">—</span>;
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

const MemberIdentity = ({ user, onNameClick }) => (
  <div className="min-w-0 space-y-1">
    {isActiveValidMember(user)
      ? <button type="button" className="truncate text-left font-medium text-emerald-800 underline decoration-dotted" onClick={() => onNameClick(user)}>{user.name || '未命名使用者'}</button>
      : <span className="block truncate font-medium text-gray-700">{user.name || '未命名使用者'}</span>}
    <div className="flex min-w-0 flex-wrap items-center gap-1 text-[11px] text-gray-500">
      <span className="whitespace-nowrap">員編 {formatEmployeeId(user.employeeId)}</span>
      <IdentityStatusBadges fields={['lineBinding']} lineBound={user.lineBound} lineUserId={user.lineUserId} shortLineLabel />
    </div>
  </div>
);

const UserDetailsAction = ({ user, onSelect }) => (
  <button
    type="button"
    className="rounded-lg border border-emerald-700 px-2 py-1.5 text-xs font-bold text-emerald-800"
    onClick={() => onSelect(user)}
    aria-label={`檢視 ${formatEmployeeId(user.employeeId)} 使用者`}
    title="檢視使用者"
  >明細</button>
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
  onDelegateOrderUser,
  onUserNameUpdated,
  canTransferLineBinding = false,
  onLineBindingTransferCompleted,
  canRepairInvalidEmployee = false,
  includeInvalidMembers = false,
  onIncludeInvalidMembersChange,
  onInvalidEmployeeRepairCompleted
}) {
  const [sort, setSort] = useState({ key: 'balance', direction: 'asc' });
  const toggleSort = (key) => setSort(current => ({ key, direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc' }));
  const SortHeading = ({ field, children }) => <button type="button" className="flex items-center gap-1 whitespace-nowrap font-bold hover:text-emerald-700" onClick={() => toggleSort(field)} aria-label={`${children}排序`} aria-pressed={sort.key === field}>{children}<span aria-hidden="true">{sort.key === field ? (sort.direction === 'asc' ? '↑' : '↓') : '↕'}</span></button>;
  const [employeeIdFilter, setEmployeeIdFilter] = useState('');
  const [selectedUser, setSelectedUser] = useState(null);
  const [editingName, setEditingName] = useState(null);
  const [nameDraft, setNameDraft] = useState('');
  const [nameSaving, setNameSaving] = useState(false);
  const [nameError, setNameError] = useState('');
  const [transferSource, setTransferSource] = useState(null);
  const [transferTargetEmployeeId, setTransferTargetEmployeeId] = useState('');
  const [transferPreview, setTransferPreview] = useState(null);
  const [transferLoading, setTransferLoading] = useState(false);
  const [transferSaving, setTransferSaving] = useState(false);
  const [transferError, setTransferError] = useState('');
  const [transferConfirmed, setTransferConfirmed] = useState(false);
  const [transferSuccess, setTransferSuccess] = useState('');
  const [repairSource, setRepairSource] = useState(null);
  const [repairTargetUserId, setRepairTargetUserId] = useState('');
  const [repairPreview, setRepairPreview] = useState(null);
  const [repairLoading, setRepairLoading] = useState(false);
  const [repairSaving, setRepairSaving] = useState(false);
  const [repairError, setRepairError] = useState('');
  const [repairTargetNameConfirmation, setRepairTargetNameConfirmation] = useState('');
  const [repairConfirmed, setRepairConfirmed] = useState(false);
  const [repairSuccess, setRepairSuccess] = useState('');
  const [repairAuditOpen, setRepairAuditOpen] = useState(false);
  const [repairAuditEntries, setRepairAuditEntries] = useState(null);
  const [repairAuditLoading, setRepairAuditLoading] = useState(false);
  const [repairAuditError, setRepairAuditError] = useState('');
  const startNameEdit = (user) => {
    if (isViewAsMode || !user.userId || !isActiveValidMember(user)) return;
    setEditingName(user);
    setNameDraft(user.name || '');
    setNameError('');
  };
  const saveName = async (event) => {
    event.preventDefault();
    const displayName = nameDraft.trim();
    if (!editingName?.userId || nameSaving) return;
    if (!displayName || displayName.length > 100) {
      setNameError('姓名需為 1～100 個字元');
      return;
    }
    setNameSaving(true);
    setNameError('');
    try {
      const response = await apiClient.updateAdminUserName({ userId: editingName.userId, displayName });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error('UPDATE_FAILED');
      setEditingName(null);
      await onUserNameUpdated?.();
    } catch {
      setNameError('儲存失敗，請確認管理權限並重試。');
    } finally {
      setNameSaving(false);
    }
  };
  const startLineBindingTransfer = (user) => {
    if (!canTransferLineBinding || isViewAsMode || !user?.userId || !isActiveValidMember(user)) return;
    setSelectedUser(null);
    setTransferSource(user);
    setTransferTargetEmployeeId('');
    setTransferPreview(null);
    setTransferError('');
    setTransferConfirmed(false);
    setTransferSuccess('');
  };
  const closeLineBindingTransfer = () => {
    if (transferSaving) return;
    setTransferSource(null);
    setTransferPreview(null);
    setTransferError('');
    setTransferConfirmed(false);
  };
  const loadLineBindingTransferPreview = async (event) => {
    event.preventDefault();
    const employeeId = transferTargetEmployeeId.trim();
    if (!transferSource?.userId || !employeeId || transferLoading || transferSaving) return;
    setTransferLoading(true);
    setTransferPreview(null);
    setTransferError('');
    setTransferConfirmed(false);
    try {
      const response = await apiClient.previewAdminLineBindingTransfer({
        sourceUserId: transferSource.userId,
        employeeId
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || `HTTP_${response.status}`);
      setTransferPreview(data);
    } catch (error) {
      setTransferError(getLineBindingTransferMessage(error));
    } finally {
      setTransferLoading(false);
    }
  };
  const submitLineBindingTransfer = async () => {
    if (!canTransferLineBinding || isViewAsMode || !transferSource?.userId
      || !transferPreview?.readyToTransfer || !transferConfirmed
      || transferSaving || transferLoading) return;
    setTransferSaving(true);
    setTransferError('');
    try {
      const response = await apiClient.transferAdminLineBinding({
        sourceUserId: transferSource.userId,
        employeeId: transferTargetEmployeeId.trim(),
        previewFingerprint: transferPreview.previewFingerprint
      });
      const data = await response.json();
      if (!response.ok || !data?.success) throw new Error(data?.error || `HTTP_${response.status}`);
      setTransferSource(null);
      setTransferPreview(null);
      setTransferConfirmed(false);
      setTransferSuccess(`LINE 綁定已移轉至員編 ${formatEmployeeId(data.targetEmployeeId)}；已重新載入使用者資料。`);
      await onLineBindingTransferCompleted?.();
    } catch (error) {
      setTransferError(getLineBindingTransferMessage(error));
    } finally {
      setTransferSaving(false);
    }
  };
  const startInvalidEmployeeRepair = (user) => {
    if (!canRepairInvalidEmployee || isViewAsMode || !user?.userId || !isActiveValidMember(user)) return;
    setSelectedUser(null);
    setRepairSource(user);
    setRepairTargetUserId('');
    setRepairPreview(null);
    setRepairError('');
    setRepairTargetNameConfirmation('');
    setRepairConfirmed(false);
  };
  const loadInvalidEmployeeRepairPreview = async (event) => {
    event.preventDefault();
    if (!canRepairInvalidEmployee || isViewAsMode || !repairSource?.userId || !repairTargetUserId || repairLoading || repairSaving) return;
    setRepairLoading(true);
    setRepairPreview(null);
    setRepairError('');
    setRepairTargetNameConfirmation('');
    setRepairConfirmed(false);
    try {
      const response = await apiClient.previewInvalidEmployeeRepair({
        sourceUserId: repairSource.userId,
        targetUserId: repairTargetUserId
      });
      const data = await response.json();
      if (!response.ok || !data?.success) throw new Error(data?.error || `HTTP_${response.status}`);
      setRepairPreview(data);
    } catch (error) {
      setRepairError(error?.message === 'ADMIN_LINE_AUTH_REQUIRED'
        ? '此操作只允許 LINE 登入的 Admin 使用，View As 不可執行。'
        : '無法取得修復預覽。請確認來源與目標帳號後重試。');
    } finally {
      setRepairLoading(false);
    }
  };
  const submitInvalidEmployeeRepair = async () => {
    if (!canRepairInvalidEmployee || isViewAsMode || !repairSource?.userId
      || !repairPreview?.readyToRepair || !repairConfirmed
      || repairTargetNameConfirmation !== repairPreview.target?.displayName
      || repairSaving || repairLoading) return;
    setRepairSaving(true);
    setRepairError('');
    try {
      const response = await apiClient.repairInvalidEmployee({
        sourceUserId: repairSource.userId,
        targetUserId: repairPreview.target.userId,
        expectedSourceUpdatedAt: repairPreview.source.updatedAt,
        expectedTargetUpdatedAt: repairPreview.target.updatedAt,
        expectedSourceDisplayName: repairPreview.source.displayName,
        expectedSourceEmployeeId: repairPreview.source.employeeId,
        expectedTargetEmployeeId: repairPreview.target.employeeId,
        expectedSourceBalance: repairPreview.source.balance,
        expectedTargetBalance: repairPreview.target.balance,
        confirmTargetDisplayName: repairTargetNameConfirmation
      });
      const data = await response.json();
      if (!response.ok || !data?.success) throw new Error(data?.error || `HTTP_${response.status}`);
      setRepairSource(null);
      setRepairPreview(null);
      setRepairTargetNameConfirmation('');
      setRepairConfirmed(false);
      setRepairSuccess('誤建員編帳號已停用並加入稽核；目標帳號姓名已同步，資料清單已重新載入。');
      await onInvalidEmployeeRepairCompleted?.();
    } catch (error) {
      setRepairError(error?.message === 'INVALID_EMPLOYEE_REPAIR_STALE'
        ? '來源或目標資料已變更，請關閉此視窗並重新取得預覽。'
        : error?.message === 'TARGET_NAME_CONFIRMATION_REQUIRED'
          ? '請輸入預覽中目標帳號目前的完整姓名以確認覆寫。'
          : '修復未完成，資料未變更。請重新取得預覽後再試。');
    } finally {
      setRepairSaving(false);
    }
  };
  const closeInvalidEmployeeRepair = () => {
    if (repairSaving) return;
    setRepairSource(null);
    setRepairPreview(null);
    setRepairError('');
    setRepairTargetNameConfirmation('');
    setRepairConfirmed(false);
  };
  const openInvalidEmployeeRepairAudit = async () => {
    if (!canRepairInvalidEmployee || isViewAsMode || repairAuditLoading) return;
    setRepairAuditOpen(true);
    setRepairAuditLoading(true);
    setRepairAuditError('');
    try {
      const response = await apiClient.getInvalidEmployeeRepairAudit();
      const data = await response.json();
      if (!response.ok || !data?.success) throw new Error(data?.error || `HTTP_${response.status}`);
      setRepairAuditEntries(data.repairs || []);
    } catch {
      setRepairAuditError('無法讀取修復稽核紀錄，請確認 LINE Admin 權限後重試。');
    } finally {
      setRepairAuditLoading(false);
    }
  };
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
  const adminMembers = useMemo(
    () => getAdminMemberRows(memberBalances, { includeInvalid: includeInvalidMembers }),
    [includeInvalidMembers, memberBalances]
  );
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
  const UserNavigationActions = ({ user }) => (
    isViewAsMode || !isActiveValidMember(user) ? null : <div className="flex flex-wrap gap-1">
    {canViewAsUser && <button type="button" onClick={() => onViewAsUser(user)} className="rounded-lg bg-slate-700 px-2 py-1.5 text-xs font-bold text-white">檢視身分</button>}
    {canDelegateOrder && <button type="button" onClick={() => onDelegateOrderUser(user)} className="rounded-lg bg-sky-700 px-2 py-1.5 text-xs font-bold text-white">代點餐</button>}
  </div>
  );

  return (
    <div className="space-y-4">
      {transferSuccess && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">{transferSuccess}</p>}
      {repairSuccess && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">{repairSuccess}</p>}
      <div className="bg-white p-4 rounded-2xl shadow-sm border border-emerald-900/10 space-y-3">
        <div>
          <h3 className="font-bold text-base text-[#2C4A3E]">👥 使用者管理中心</h3>
          <p className="text-xs text-gray-500">統一搜尋使用者、查詢餘額與交易紀錄，並依管理權限檢視身分、代點餐或儲值；所有操作沿用既有授權規則。</p>
        </div>
        {canRepairInvalidEmployee && !isViewAsMode && <button type="button" onClick={openInvalidEmployeeRepairAudit} className="min-h-11 rounded-xl border border-rose-300 px-4 py-2 text-sm font-bold text-rose-800 hover:bg-rose-50">查詢誤建員編修復稽核</button>}
        {canRepairInvalidEmployee && !isViewAsMode && <label className="flex min-h-11 items-center gap-2 text-sm font-medium text-rose-900">
          <input
            type="checkbox"
            checked={includeInvalidMembers}
            disabled={memberBalancesLoading}
            onChange={(event) => onIncludeInvalidMembersChange?.(event.target.checked)}
            className="size-4 accent-rose-800"
          />
          包含停用／誤建帳號
        </label>}
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
        <p className="hidden text-xs text-gray-500 md:block">預設依餘額由小到大排序，點選表格標題可切換排序。</p>
        <div className="flex items-end gap-2 md:hidden" role="group" aria-label="使用者排序">
          <label className="min-w-0 flex-1 text-xs font-medium text-gray-600">排序欄位
            <select aria-label="排序欄位" value={sort.key} onChange={(event) => setSort(current => ({ ...current, key: event.target.value }))} className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800">
              <option value="balance">餘額</option>
              <option value="employeeId">員編</option>
              <option value="name">姓名</option>
              <option value="floor">樓層</option>
              <option value="role">角色</option>
            </select>
          </label>
          <button type="button" aria-label="切換排序方向" onClick={() => setSort(current => ({ ...current, direction: current.direction === 'asc' ? 'desc' : 'asc' }))} className="shrink-0 rounded-lg border border-emerald-700 px-3 py-2 text-sm font-bold text-emerald-800">
            {sort.direction === 'asc' ? '↑ 由小到大' : '↓ 由大到小'}
          </button>
        </div>
      </div>

      {editingName && !isViewAsMode && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !nameSaving) setEditingName(null); }}>
        <form onSubmit={saveName} className="w-full max-w-md rounded-2xl border border-emerald-200 bg-white p-5 shadow-2xl space-y-4" role="dialog" aria-modal="true" aria-label="修改使用者姓名">
          <div className="flex items-start justify-between gap-3">
            <div><h3 className="font-bold text-lg">修改姓名</h3><p className="mt-1 text-xs text-gray-500">員編 {formatEmployeeId(editingName.employeeId)}</p></div>
            <button type="button" onClick={() => !nameSaving && setEditingName(null)} className="rounded-lg px-2 py-1 text-gray-500 hover:bg-gray-100" aria-label="關閉修改姓名">✕</button>
          </div>
          <label className="block text-sm">姓名
            <input autoFocus required maxLength={100} value={nameDraft} onChange={(event) => setNameDraft(event.target.value)} className="mt-1 w-full rounded-xl border border-gray-300 p-3" />
          </label>
          {nameError && <p role="alert" className="text-sm text-red-700">{nameError}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setEditingName(null)} disabled={nameSaving} className="rounded-lg border px-4 py-2 disabled:opacity-50">取消</button>
            <button type="submit" disabled={nameSaving} className="rounded-lg bg-emerald-800 px-4 py-2 text-white disabled:opacity-50">{nameSaving ? '儲存中…' : '儲存'}</button>
          </div>
        </form>
      </div>}
      {selectedUser && !isViewAsMode && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedUser(null); }}>
        <section className="flex max-h-[90dvh] w-full max-w-2xl flex-col overflow-y-auto rounded-2xl border border-emerald-200 bg-white p-5 shadow-2xl" role="dialog" aria-modal="true" aria-label="使用者交易明細">
          <div className="flex items-start justify-between gap-3">
            <div><h3 className="font-bold text-lg">{selectedUser.name || '使用者'}｜檢視使用者</h3><p className="mt-1 text-xs text-gray-500">員編 {formatEmployeeId(selectedUser.employeeId)} · 目前名單餘額 {formatBalanceAmount(selectedUser.balance)}</p></div>
            <button type="button" onClick={() => setSelectedUser(null)} className="rounded-lg px-2 py-1 text-gray-500 hover:bg-gray-100" aria-label="關閉交易明細">✕</button>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 rounded-xl bg-gray-50 p-3 text-sm sm:grid-cols-4">
            <div><div className="text-xs text-gray-500">姓名</div><div className="break-words">{selectedUser.name || '未命名使用者'}</div></div>
            <div><div className="text-xs text-gray-500">樓層</div><div>{selectedUser.floor || '未設定'}</div></div>
            <div><div className="text-xs text-gray-500">角色</div><div>{selectedUser.role || 'User'}</div></div>
            <div><div className="text-xs text-gray-500">LINE 綁定</div><div>{selectedUser.lineBound ? '已綁定' : '未綁定'}</div></div>
          </div>
          {canTransferLineBinding && isActiveValidMember(selectedUser) && <button
            type="button"
            onClick={() => startLineBindingTransfer(selectedUser)}
            className="mt-3 min-h-11 w-full rounded-xl bg-amber-700 px-4 py-2 text-sm font-bold text-white hover:bg-amber-600 sm:w-auto"
          >修正 LINE 綁定</button>}
          {canRepairInvalidEmployee && isActiveValidMember(selectedUser) && !isViewAsMode && <button
            type="button"
            onClick={() => startInvalidEmployeeRepair(selectedUser)}
            className="mt-3 min-h-11 w-full rounded-xl bg-rose-800 px-4 py-2 text-sm font-bold text-white hover:bg-rose-700 sm:ml-2 sm:w-auto"
          >修正誤建員編</button>}
          <label className="mt-4 block text-sm">交易月份 <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="ml-2 rounded border p-1" /></label>
          <div className="mt-4 min-h-0 flex-1">
            {ledgerLoading ? <p role="status">讀取交易明細中…</p> : ledgerError ? <p role="alert" className="text-red-700">{ledgerError}</p> : ledger && <>
              <div className="grid grid-cols-2 gap-2 text-sm"><div>期初餘額：{formatBalanceAmount(ledger.openingBalance)}</div><div>當月期末：{formatBalanceAmount(ledger.closingBalance)}</div><div>當月入帳：+{formatBalanceAmount(ledger.totalCredit)}</div><div>當月扣款：-{formatBalanceAmount(ledger.totalDebit)}</div></div>
              {ledger.reconciliation?.status && ledger.reconciliation.status !== 'CONSISTENT' && <p role="alert" className="mt-3 text-amber-800">交易帳務存在需檢查的差異，請勿自行調整餘額。</p>}
              {ledger.transactions?.length ? <div className="mt-3 space-y-2">{ledger.transactions.map(tx => <div key={tx.transactionId} className="border-t py-2 text-sm"><div className="flex justify-between gap-2"><span>{tx.description || tx.type}</span><strong>{tx.amount > 0 ? '+' : ''}{formatBalanceAmount(tx.amount)}</strong></div><div className="flex flex-wrap justify-between text-xs text-gray-500 gap-2"><span>{formatDateTime(tx.occurredAt)}</span><span>交易後餘額 {formatBalanceAmount(tx.balanceAfter)}</span></div></div>)}</div> : <p className="mt-3 text-sm text-gray-500">該月份沒有交易明細。</p>}
            </>}
          </div>
        </section>
      </div>}
      {repairSource && canRepairInvalidEmployee && !isViewAsMode && <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-3 sm:p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeInvalidEmployeeRepair(); }}>
        <section className="flex max-h-[94dvh] w-full max-w-2xl flex-col overflow-y-auto rounded-2xl border border-rose-200 bg-white shadow-2xl" role="dialog" aria-modal="true" aria-label="修正誤建員編">
          <div className="space-y-2 border-b border-rose-100 p-4 sm:p-5">
            <div className="flex items-start justify-between gap-3">
              <div><h3 className="font-bold text-lg text-rose-950">誤建員編安全修復</h3><p className="mt-1 text-sm text-gray-600">來源帳號：{repairSource.name || '未命名使用者'} · 員編 {formatEmployeeId(repairSource.employeeId)}</p></div>
              <button type="button" onClick={closeInvalidEmployeeRepair} disabled={repairSaving} className="min-h-11 min-w-11 rounded-lg px-2 text-gray-500 hover:bg-gray-100 disabled:opacity-50" aria-label="關閉誤建員編修復">✕</button>
            </div>
          <p className="rounded-xl bg-rose-50 p-3 text-sm leading-6 text-rose-950">修復會把來源姓名同步到目標、將來源標記為 INVALID_EMPLOYEE_ID 並停用。來源自己的餘額、訂單與歷史帳務留在來源，不會轉入目標。目標的 LINE 綁定、員編、角色、樓層、餘額、訂單與歷史帳務都會保留；不會移轉 LINE 綁定。</p>
          </div>
          <div className="space-y-4 overflow-y-auto p-4 sm:p-5">
            <form onSubmit={loadInvalidEmployeeRepairPreview} className="space-y-3">
              <label className="block text-sm font-medium">選擇正確的目標帳號
                <select required value={repairTargetUserId} onChange={(event) => { setRepairTargetUserId(event.target.value); setRepairPreview(null); setRepairError(''); setRepairConfirmed(false); setRepairTargetNameConfirmation(''); }} disabled={repairLoading || repairSaving} className="mt-1 min-h-11 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm">
                  <option value="">選擇有效的目標帳號</option>
                  {adminMembers.filter((user) => user.userId !== repairSource.userId && user.active !== false && !user.invalidReason && user.employeeId && user.name).map((user) => <option key={user.userId} value={user.userId}>{user.name} · 員編 {formatEmployeeId(user.employeeId)} · {user.role || 'User'} · {user.floor || '未設定樓層'}</option>)}
                </select>
              </label>
              <button type="submit" disabled={!repairTargetUserId || repairLoading || repairSaving} className="min-h-11 w-full rounded-xl bg-rose-800 px-4 py-2 font-bold text-white disabled:opacity-50">{repairLoading ? '取得預覽中…' : '預覽來源與目標'}</button>
            </form>
            {repairPreview && <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {[['來源帳號', repairPreview.source], ['目標帳號', repairPreview.target]].map(([label, user]) => <article key={label} className="min-w-0 rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm">
                  <h4 className="font-bold text-gray-900">{label}</h4>
                  <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
                    <dt className="text-gray-500">姓名</dt><dd className="break-words font-medium">{user.displayName}</dd>
                    <dt className="text-gray-500">員編</dt><dd className="break-words">{formatEmployeeId(user.employeeId)}</dd>
                    <dt className="text-gray-500">角色</dt><dd>{user.role}</dd>
                    <dt className="text-gray-500">樓層</dt><dd>{user.pickupFloor}</dd>
                    <dt className="text-gray-500">LINE 綁定</dt><dd>{user.lineBound ? '已綁定' : '未綁定'}</dd>
                    <dt className="text-gray-500">餘額</dt><dd>{formatBalanceAmount(user.balance)}</dd>
                    {label === '來源帳號' && <><dt className="text-gray-500">帳號狀態</dt><dd>{user.active ? '啟用' : '停用'}{user.invalidReason ? ` · ${user.invalidReason}` : ''}</dd></>}
                  </dl>
                </article>)}
              </div>
              {repairPreview.conflicts?.length > 0 && <div role="alert" className="space-y-1 rounded-lg bg-amber-50 p-3 text-sm text-amber-900"><p className="font-semibold">目前無法修復：</p>{repairPreview.conflicts.map((code) => <p key={code}>{getInvalidEmployeeRepairMessage(code)}</p>)}</div>}
              {repairPreview.readyToRepair && <div className="space-y-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                <p className="text-sm font-bold text-emerald-950">預覽結果：目標姓名將覆寫為「{repairPreview.changes.targetDisplayName}」。來源會被標記為 INVALID_EMPLOYEE_ID 並停用；不修改訂單或帳務。</p>
                <label className="block text-sm">再次確認目標目前姓名：<strong className="break-words">{repairPreview.target.displayName}</strong>
                  <input autoComplete="off" value={repairTargetNameConfirmation} onChange={(event) => setRepairTargetNameConfirmation(event.target.value)} disabled={repairSaving} className="mt-1 min-h-11 w-full rounded-xl border border-gray-300 bg-white px-3 py-2" aria-label="輸入目標目前姓名以確認覆寫" />
                </label>
                <label className="flex items-start gap-2 text-sm text-gray-800"><input type="checkbox" className="mt-1 size-4 shrink-0" checked={repairConfirmed} onChange={(event) => setRepairConfirmed(event.target.checked)} disabled={repairSaving} /><span>我已核對來源與目標，並確認同步來源姓名、停用來源帳號。</span></label>
                <button type="button" onClick={submitInvalidEmployeeRepair} disabled={!repairConfirmed || repairTargetNameConfirmation !== repairPreview.target.displayName || repairSaving || repairLoading} className="min-h-11 w-full rounded-xl bg-emerald-800 px-4 py-2 font-bold text-white disabled:opacity-50">{repairSaving ? '安全修復中…' : '確認修復並記錄稽核'}</button>
              </div>}
            </>}
            {repairError && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{repairError}</p>}
          </div>
          <div className="border-t border-gray-100 p-4 sm:px-5"><button type="button" onClick={closeInvalidEmployeeRepair} disabled={repairSaving} className="min-h-11 w-full rounded-xl border border-gray-300 px-4 py-2 font-semibold text-gray-700 disabled:opacity-50 sm:w-auto">取消</button></div>
        </section>
      </div>}
      {repairAuditOpen && canRepairInvalidEmployee && !isViewAsMode && <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-3 sm:p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setRepairAuditOpen(false); }}>
        <section className="flex max-h-[94dvh] w-full max-w-3xl flex-col overflow-y-auto rounded-2xl border border-rose-200 bg-white shadow-2xl" role="dialog" aria-modal="true" aria-label="誤建員編修復稽核">
          <div className="flex items-start justify-between gap-3 border-b p-4 sm:p-5"><div><h3 className="font-bold text-lg">誤建員編修復稽核</h3><p className="mt-1 text-xs text-gray-500">僅列出已完成並記錄稽核的安全修復。</p></div><button type="button" onClick={() => setRepairAuditOpen(false)} className="min-h-11 min-w-11 rounded-lg px-2 text-gray-500 hover:bg-gray-100" aria-label="關閉修復稽核">✕</button></div>
          <div className="space-y-3 p-4 sm:p-5">{repairAuditLoading ? <p role="status">讀取修復稽核中…</p> : repairAuditError ? <p role="alert" className="text-sm text-rose-800">{repairAuditError}</p> : !repairAuditEntries?.length ? <p className="text-sm text-gray-500">目前沒有已完成的修復紀錄。</p> : repairAuditEntries.map((entry) => <article key={entry.auditId} className="rounded-xl border border-gray-200 p-3 text-sm"><div className="flex flex-wrap justify-between gap-2"><strong>{entry.sourceDisplayName || '來源帳號'} → {entry.targetDisplayName || '目標帳號'}</strong><time className="text-xs text-gray-500">{formatDateTime(entry.occurredAt)}</time></div><dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 text-xs text-gray-600 sm:grid-cols-2"><div>稽核編號：{entry.requestId || entry.auditId}</div><div>來源員編：{formatEmployeeId(entry.sourceEmployeeId)} · {entry.sourceInvalidReason || '未標記'}</div><div>來源停用後餘額：{formatBalanceAmount(entry.sourceBalance)}</div><div>目標原姓名：{entry.targetOriginalDisplayName || '未記錄'}</div><div>目標員編：{formatEmployeeId(entry.targetEmployeeId)} · {entry.targetRole || 'User'}</div><div>目標樓層：{entry.targetPickupFloor || '未設定'} · LINE {entry.targetLineBound ? '已綁定' : '未綁定'}</div><div>目標修復時餘額：{formatBalanceAmount(entry.targetBalance)}</div></dl></article>)}</div>
        </section>
      </div>}
      {transferSource && canTransferLineBinding && !isViewAsMode && <div
        className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-2 sm:p-4"
        role="presentation"
        onMouseDown={(event) => { if (event.target === event.currentTarget) closeLineBindingTransfer(); }}
      >
        <section className="flex max-h-[94dvh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-emerald-200 bg-white shadow-2xl" role="dialog" aria-modal="true" aria-label="修正 LINE 綁定">
          <div className="flex items-start justify-between gap-3 border-b border-gray-100 p-4 sm:p-5">
            <div><h3 className="font-bold text-lg">修正 LINE 綁定</h3><p className="mt-1 text-sm text-gray-600">僅移轉 LINE 身分；不合併訂單、交易、餘額或個人資料。</p></div>
            <button type="button" onClick={closeLineBindingTransfer} disabled={transferSaving} className="rounded-lg px-2 py-1 text-gray-500 hover:bg-gray-100 disabled:opacity-50" aria-label="關閉 LINE 綁定修正">✕</button>
          </div>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:p-5">
            <div className="rounded-xl bg-amber-50 p-3 text-sm">
              <div className="font-semibold">來源帳號</div>
              <div>{transferSource.name || '未命名使用者'} · 員編 {formatEmployeeId(transferSource.employeeId)}</div>
              <div className="break-all text-xs text-gray-600">LINE 綁定：{transferSource.lineBound ? '已綁定' : '待後端確認'}</div>
            </div>
            <form onSubmit={loadLineBindingTransferPreview} className="space-y-3">
              <label className="block text-sm font-medium">正確員編
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={100}
                  required
                  value={transferTargetEmployeeId}
                  onChange={(event) => {
                    setTransferTargetEmployeeId(event.target.value);
                    setTransferPreview(null);
                    setTransferConfirmed(false);
                    setTransferError('');
                  }}
                  className="mt-1 min-h-11 w-full rounded-xl border border-gray-300 p-3"
                  aria-label="正確員編"
                />
              </label>
              <button type="submit" disabled={transferLoading || transferSaving || !transferTargetEmployeeId.trim()} className="min-h-11 w-full rounded-xl border border-emerald-700 px-4 py-2 font-bold text-emerald-800 disabled:opacity-50 sm:w-auto">
                {transferLoading ? '取得預覽中…' : '取得移轉預覽'}
              </button>
            </form>
            {transferError && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-800">{transferError}</p>}
            {transferPreview && <div className="space-y-3 rounded-xl border border-gray-200 p-3 sm:p-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {[['來源', transferPreview.source], ['目標', transferPreview.target]].map(([label, user]) => (
                  <div key={label} className="min-w-0 rounded-lg bg-gray-50 p-3 text-sm">
                    <div className="font-bold">{label}帳號</div>
                    <div className="break-words">{user?.displayName || '未命名使用者'} · 員編 {formatEmployeeId(user?.employeeId)}</div>
                    <div className="text-xs text-gray-600">LINE：{user?.lineBinding?.masked || '未綁定'}</div>
                    <div className="mt-2 grid grid-cols-2 gap-x-2 gap-y-1 text-xs text-gray-600">
                      <span>訂單 {user?.relatedData?.orderCount ?? '—'}</span>
                      <span>交易 {user?.relatedData?.transactionCount ?? '—'}</span>
                      <span>餘額 {user?.relatedData ? formatBalanceAmount(user.relatedData.balance) : '—'}</span>
                      {label === '來源' && <span>待撤銷 Session {transferPreview.sourceSessionsToRevoke ?? 0}</span>}
                    </div>
                  </div>
                ))}
              </div>
              <div>
                <h4 className="font-semibold text-sm">資料檢查</h4>
                <ul className="mt-1 space-y-1 text-sm">
                  {[
                    ['sourceExists', '來源帳號存在'],
                    ['targetExists', '目標帳號存在'],
                    ['sourceActive', '來源帳號有效'],
                    ['targetActive', '目標帳號有效'],
                    ['sourceLineBound', '來源有 LINE 綁定'],
                    ['targetLineUnbound', '目標未綁其他 LINE'],
                    ['sourceHasNoOrders', '來源沒有訂單'],
                    ['sourceHasNoTransactions', '來源沒有帳務交易'],
                    ['sourceBalanceIsZero', '來源餘額為零'],
                    ['sourceHasNoOtherData', '來源沒有其他不可移轉資料']
                  ].map(([key, label]) => (
                    <li key={key} className={transferPreview.checks?.[key] ? 'text-emerald-800' : 'text-rose-800'}>
                      {transferPreview.checks?.[key] ? '✓' : '✕'} {label}
                    </li>
                  ))}
                </ul>
              </div>
              {transferPreview.conflicts?.length > 0 && <div role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">
                {transferPreview.conflicts.map((code) => <p key={code}>{getLineBindingTransferMessage(code)}</p>)}
              </div>}
              {transferPreview.readyToTransfer && <div className="space-y-3 rounded-lg bg-emerald-50 p-3">
                <p className="text-sm text-emerald-900">檢查通過。目標帳號的歷史訂單與帳務維持原樣；系統會撤銷來源帳號尚有效的員工 Session。</p>
                <label className="flex items-start gap-2 text-sm text-gray-800">
                  <input type="checkbox" className="mt-1 size-4 shrink-0" checked={transferConfirmed} onChange={(event) => setTransferConfirmed(event.target.checked)} disabled={transferSaving} />
                  <span>我已核對來源與目標員編，並確認只移轉 LINE 綁定。</span>
                </label>
                <button type="button" onClick={submitLineBindingTransfer} disabled={!transferConfirmed || transferSaving || transferLoading} className="min-h-11 w-full rounded-xl bg-emerald-800 px-4 py-2 font-bold text-white disabled:opacity-50">
                  {transferSaving ? '移轉中…' : '確認移轉 LINE 綁定'}
                </button>
              </div>}
            </div>}
          </div>
          <div className="border-t border-gray-100 p-4 sm:px-5">
            <button type="button" onClick={closeLineBindingTransfer} disabled={transferSaving} className="min-h-11 w-full rounded-xl border border-gray-300 px-4 py-2 font-semibold text-gray-700 disabled:opacity-50 sm:w-auto">取消</button>
          </div>
        </section>
      </div>}
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
            <table className="w-full table-fixed text-left text-xs">
              <thead className="bg-gray-100 text-gray-600">
                <tr>
                  <th className="w-[24%] p-2"><SortHeading field="employeeId">員編／姓名</SortHeading></th>
                  <th className="w-[20%] p-2"><SortHeading field="role">角色／LINE 綁定</SortHeading></th>
                  <th className="w-[10%] p-2"><SortHeading field="floor">樓層</SortHeading></th>
                  <th className="w-[15%] p-2" aria-sort={sort.key === 'balance' ? (sort.direction === 'asc' ? 'ascending' : 'descending') : undefined}><SortHeading field="balance">餘額</SortHeading></th>
                  <th className="w-[31%] p-2">操作</th>
                </tr>
              </thead>
              <tbody>
                {filteredMembers.map((user, idx) => (
                  <tr key={memberKey(user, idx)} className="border-b last:border-0 align-top">
                    <td className="p-2">
                      <div className="font-mono text-xs">{formatEmployeeId(user.employeeId)}</div>
                      {isActiveValidMember(user)
                        ? <button type="button" onClick={() => startNameEdit(user)} className="mt-1 break-words text-left font-medium text-emerald-800 underline decoration-dotted hover:decoration-solid" aria-label={`修改 ${user.name || '未命名使用者'} 的姓名`}>{user.name || '未命名使用者'}</button>
                        : <span className="mt-1 block break-words font-medium text-gray-700">{user.name || '未命名使用者'}</span>}
                    </td>
                    <td className="p-2">
                      <div className="font-medium">{user.role || 'User'}</div>
                      <div className="mt-1"><IdentityStatusBadges fields={['lineBinding']} lineBound={user.lineBound} lineUserId={user.lineUserId} /></div>
                    </td>
                    <td className="p-2">{user.floor || '未設定'}</td>
                    <td className="p-2"><BalanceBadge balance={user.balance} /></td>
                    <td className="p-2">
                      <div className="flex flex-wrap gap-1">
                        <UserNavigationActions user={user} />
                        <MemberAction {...{ user, canTopup, canBindEmployee, isViewAsMode, onOpenTopupModal, onOpenEmployeeBindModal }} />
                        {!isViewAsMode && <UserDetailsAction user={user} onSelect={setSelectedUser} />}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-2 md:hidden">
            {filteredMembers.map((user, idx) => (
              <article key={memberKey(user, idx)} className="rounded-2xl border border-gray-100 bg-gray-50 p-3 space-y-2">
                <MemberIdentity user={user} onNameClick={startNameEdit} />
                <div className="flex flex-wrap items-center gap-1">
                  {hasActions && <UserNavigationActions user={user} />}
                  {hasActions && <MemberAction {...{ user, canTopup, canBindEmployee, isViewAsMode, onOpenTopupModal, onOpenEmployeeBindModal }} />}
                  {!isViewAsMode && <UserDetailsAction user={user} onSelect={setSelectedUser} />}
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

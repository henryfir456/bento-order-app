import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiClient } from '../../api/apiClient';
import { formatApiErrorDiagnostic } from '../../api/apiErrors';
import { canRecordVendorTransfer, isVendorEnabled, vendorOperationsView } from './vendorOperationsPolicy';
import VendorDaySummary from './VendorDaySummary';
import VendorHistoryImport from './VendorHistoryImport';
import { currency, dayStatusLabel, formatTaipeiTime, vendorItemLabel } from './vendorDayFormat';

const taipeiToday = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit'
}).format(new Date());
const currentMonth = () => taipeiToday().slice(0, 7);
const createKey = () => `vendor-transfer-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
const reasonLabel = (reason) => ({
  AFTER_CUTOFF_BASELINE: '截止後建立基準快照',
  ORDER_CANCELLATION_REFUND: '訂單取消／退款後新增調整版本',
  ORDER_REPLACEMENT_OR_PRICE_CHANGE: '訂單更換／價格變更後新增調整版本',
  ORDER_ACTIVITY_CHANGE: '訂單變動後新增調整版本'
}[reason] || reason || '—');
const VENDOR_TABS = Object.freeze([
  { key: 'today', label: '今日' },
  { key: 'orders', label: '訂單總覽' },
  { key: 'settlement', label: '對帳' }
]);
const paymentStatusLabel = (status) => ({
  REGISTERED: '已登記轉帳・待廠商確認',
  ACKNOWLEDGED: '廠商已確認收款',
  DISPUTED: '廠商提出爭議',
  RESOLVED: '爭議已處理',
  REVERSED: '轉帳紀錄已沖正'
}[status] || status);

const readResponse = async (response) => {
  let data = {};
  try { data = await response.json(); } catch { /* response contract is reported below */ }
  if (!response.ok || data?.success === false || data?.error) {
    const error = new Error(data?.error || data?.code || `HTTP ${response.status}`);
    error.code = data?.error || data?.code || 'VENDOR_OPERATIONS_REQUEST_FAILED';
    error.requestId = response.headers.get('X-Request-Id') || data?.requestId || null;
    throw error;
  }
  return data;
};

export default function VendorOperationsPage({ role = 'User', mock = false, readOnly = false }) {
  const isVendor = role === 'Vendor';
  const isAdmin = role === 'Admin';
  const [month, setMonth] = useState(currentMonth);
  const [vendors, setVendors] = useState([]);
  const [vendorId, setVendorId] = useState('');
  const [vendorName, setVendorName] = useState('');
  const [days, setDays] = useState([]);
  const [expandedDays, setExpandedDays] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  const [actualTransferDone, setActualTransferDone] = useState(false);
  const [detailsReviewed, setDetailsReviewed] = useState(false);
  const [transferAmount, setTransferAmount] = useState('');
  const [transferredOn, setTransferredOn] = useState(taipeiToday);
  const [allocations, setAllocations] = useState(() => [{ serviceDate: taipeiToday(), amountTwd: '' }]);
  const [disputeReasons, setDisputeReasons] = useState({});
  const [resolutions, setResolutions] = useState({});
  const [adjustments, setAdjustments] = useState({});
  const [reversals, setReversals] = useState({});
  const [busyKey, setBusyKey] = useState('');
  const [vendorPreview, setVendorPreview] = useState(false);
  const [tab, setTab] = useState('today');
  const view = vendorOperationsView(role, vendorPreview, readOnly);
  const requestRef = useRef(0);
  const idempotencyRef = useRef({ payload: '', key: createKey() });
  const selectedVendor = vendors.find((vendor) => vendor.id === vendorId);
  const canRecordTransfer = view.adminControls && canRecordVendorTransfer(role, selectedVendor);

  const load = useCallback(async () => {
    if (!isVendor && (!isAdmin || !vendorId)) return;
    const requestId = ++requestRef.current;
    setLoading(true);
    setError('');
    try {
      const response = isVendor
        ? await apiClient.getVendorOperations({ month })
        : await apiClient.getAdminVendorOperations({ month, vendorId });
      const data = await readResponse(response);
      if (requestId !== requestRef.current) return;
      setDays(Array.isArray(data.days) ? data.days : []);
      setVendorName(data.vendor?.name || data.vendors?.[0]?.name || '');
      if (isVendor && Array.isArray(data.vendors)) setVendors(data.vendors);
    } catch (requestError) {
      if (requestId === requestRef.current) {
        const message = requestError.code === 'FORBIDDEN' || requestError.code === 'VENDOR_SCOPE_FORBIDDEN'
          ? '目前登入身分沒有這家廠商的權限。'
          : '目前無法取得廠商訂單與對帳資料，請重新載入。';
        setError(`${message}${formatApiErrorDiagnostic(requestError)}`);
      }
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, [isAdmin, isVendor, month, vendorId]);

  useEffect(() => {
    let cancelled = false;
    if (isAdmin) {
      apiClient.getVendors().then(readResponse).then((data) => {
        if (cancelled) return;
        const list = Array.isArray(data.vendors) ? data.vendors : [];
        setVendors(list);
        setVendorId((current) => current || list[0]?.id || '');
      }).catch((requestError) => {
        if (!cancelled) setError(`目前無法載入廠商清單。${formatApiErrorDiagnostic(requestError)}`);
      });
    }
    return () => { cancelled = true; };
  }, [isAdmin]);

  useEffect(() => {
    const timer = setTimeout(() => { void load(); }, 0);
    return () => clearTimeout(timer);
  }, [load]);

  const totals = useMemo(() => days.reduce((result, day) => ({
    orderDays: result.orderDays + (Number(day.orderCount || 0) > 0 ? 1 : 0),
    amount: result.amount + Number(day.amountTwd || 0),
    orders: result.orders + Number(day.orderCount || 0),
    portions: result.portions + Number(day.portionCount || 0),
    receivable: result.receivable + Number(day.settlement?.receivableTwd || day.amountTwd || 0),
    registered: result.registered + Number(day.settlement?.registeredTransferTwd || 0),
    historical: result.historical + Number(day.settlement?.historicalSettledTwd || 0),
    unregistered: result.unregistered + Number(day.settlement?.unregisteredDifferenceTwd || 0),
    pending: result.pending + Number(day.settlement?.pendingConfirmationTwd || 0),
    confirmed: result.confirmed + Number(day.settlement?.confirmedTwd || 0),
    disputed: result.disputed + Number(day.settlement?.disputedTwd || 0)
  }), { orderDays: 0, amount: 0, orders: 0, portions: 0, receivable: 0, registered: 0, historical: 0, unregistered: 0, pending: 0, confirmed: 0, disputed: 0 }), [days]);

  const performAction = async (key, action) => {
    setBusyKey(key);
    setActionError('');
    setActionMessage('');
    try {
      await action();
      setActionMessage('已儲存，頁面資料已更新。');
      await load();
    } catch (actionFailure) {
      const code = actionFailure?.code || '';
      const messages = {
        PAYMENT_RESPONSE_ALREADY_RECORDED: '這筆轉帳已回覆，請重新整理查看最新狀態。',
        PAYMENT_ALREADY_REVERSED: '這筆轉帳已沖正，請重新整理查看最新狀態。',
        PAYMENT_DISPUTE_MUST_BE_RESOLVED: '請先處理這筆轉帳的廠商異議，再執行沖正。',
        PAYMENT_REVERSAL_CONFIRMATION_REQUIRED: '請先核對沖正原因並完成再次確認。',
        PAYMENT_REVERSAL_CONFLICT: '付款分攤剛有變動，請重新整理核對後再沖正。',
        REVERSAL_REASON_REQUIRED: '請填寫轉帳沖正原因。',
        PAYMENT_DISPUTE_ALREADY_RESOLVED: '這筆異議已處理，請重新整理查看最新狀態。',
        PAYMENT_CONFIRMATION_REQUIRED: mock
          ? '請確認這是合成 Mock 轉帳，並核對日期、總額與各日分攤。'
          : '請確認已完成實際轉帳，並再次核對日期、總額與各日分攤。',
        PAYMENT_NOT_DISPUTED: '這筆轉帳目前沒有待處理爭議。',
        VENDOR_DAY_RECEIVABLE_EXCEEDED: '分攤金額超過該日目前應收，請調整金額。',
        VENDOR_PAYMENT_ALLOCATION_INVALID: '分攤總額超過這筆轉帳金額。',
        VENDOR_ALLOCATION_ADJUSTMENT_INVALID: '調整會造成負數分攤或超過當日應收。',
        IDEMPOTENCY_KEY_REUSED: '表單內容已變更，請重新送出。'
      };
      const message = messages[code] || '操作沒有完成，請檢查欄位後重試。';
      setActionError(`${message}${formatApiErrorDiagnostic(actionFailure)}`);
    } finally {
      setBusyKey('');
    }
  };

  const submitTransfer = async (event) => {
    event.preventDefault();
    const amountTwd = Number(transferAmount);
    const normalizedAllocations = allocations.map((item) => ({
      serviceDate: item.serviceDate,
      amountTwd: Number(item.amountTwd)
    }));
    if (!actualTransferDone || !detailsReviewed) {
      setActionError(mock
        ? '請確認這是合成 Mock 轉帳，並核對日期、總額與各日分攤。'
        : '請確認已在銀行 App 完成實際轉帳，並再次核對日期、總額與各日分攤。');
      return;
    }
    if (!Number.isSafeInteger(amountTwd) || amountTwd <= 0
      || normalizedAllocations.some((item) => !item.serviceDate || !Number.isSafeInteger(item.amountTwd) || item.amountTwd <= 0)
      || normalizedAllocations.reduce((sum, item) => sum + item.amountTwd, 0) > amountTwd) {
      setActionError('請輸入有效的整數金額，且分攤合計不可超過轉帳金額。');
      return;
    }
    const payloadWithoutKey = {
      vendorId, amountTwd, transferredOn, allocations: normalizedAllocations,
      actualTransferDone, detailsReviewed
    };
    const fingerprint = JSON.stringify(payloadWithoutKey);
    if (idempotencyRef.current.payload !== fingerprint) {
      idempotencyRef.current = { payload: fingerprint, key: createKey() };
    }
    const payload = { ...payloadWithoutKey, idempotencyKey: idempotencyRef.current.key };
    await performAction('record-transfer', async () => {
      await readResponse(await apiClient.recordVendorPayment(payload));
      idempotencyRef.current = { payload: '', key: createKey() };
      setActualTransferDone(false);
      setDetailsReviewed(false);
      setTransferAmount('');
      setAllocations([{ serviceDate: taipeiToday(), amountTwd: '' }]);
    });
  };

  const clearTransferConfirmations = () => {
    setActualTransferDone(false);
    setDetailsReviewed(false);
  };
  const addAllocation = () => {
    clearTransferConfirmations();
    setAllocations((current) => current.length >= 31
      ? current
      : [...current, { serviceDate: taipeiToday(), amountTwd: '' }]);
  };
  const updateAllocation = (index, key, value) => {
    clearTransferConfirmations();
    setAllocations((current) => current.map((item, itemIndex) => (
      itemIndex === index ? { ...item, [key]: value } : item
    )));
  };
  const removeAllocation = (index) => {
    clearTransferConfirmations();
    setAllocations((current) => current.length <= 1
      ? current : current.filter((_item, itemIndex) => itemIndex !== index));
  };

  const makePaymentAction = (day, transfer) => (
    <div key={`${transfer.paymentId}-${day.serviceDate}`} className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="font-semibold text-slate-800">{paymentStatusLabel(transfer.status)}</div>
          <div className="mt-1 text-xs text-slate-600">轉帳日 {transfer.transferredOn} ・本日分攤 {currency(transfer.allocatedAmountTwd)}</div>
          <div className="text-xs text-slate-500">整筆轉帳 {currency(transfer.paymentAmountTwd)}</div>
          {transfer.unallocatedAmountTwd != null && (
            <div className={Number(transfer.unallocatedAmountTwd) > 0 ? 'text-xs text-amber-800' : 'text-xs text-slate-500'}>
              尚未分攤 {currency(transfer.unallocatedAmountTwd)}
            </div>
          )}
          {transfer.disputeReason && <p className="mt-2 text-sm text-rose-800">爭議原因：{transfer.disputeReason}</p>}
          {transfer.resolution && <p className="mt-2 text-sm text-emerald-800">處理結果：{transfer.resolution}</p>}
          {transfer.reversalReason && <p className="mt-2 text-sm text-rose-800">沖正原因：{transfer.reversalReason}</p>}
        </div>
        {view.vendorLayout && transfer.status === 'REGISTERED' && (
          <button type="button" disabled={Boolean(busyKey) || !view.vendorActionsEnabled}
            onClick={() => void performAction(`ack-${transfer.paymentId}`, async () => {
              await readResponse(await apiClient.acknowledgeVendorPayment({ paymentId: transfer.paymentId }));
            })}
            className="min-h-10 rounded-lg bg-emerald-800 px-3 py-2 text-sm font-bold text-white disabled:opacity-50">
            確認收到
          </button>
        )}
      </div>
      {view.vendorLayout && transfer.status === 'REGISTERED' && (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <label className="sr-only" htmlFor={`dispute-${transfer.paymentId}`}>轉帳爭議原因</label>
          <input id={`dispute-${transfer.paymentId}`} type="text" maxLength={500}
            value={disputeReasons[transfer.paymentId] || ''} disabled={!view.vendorActionsEnabled}
            onChange={(event) => setDisputeReasons((current) => ({ ...current, [transfer.paymentId]: event.target.value }))}
            placeholder="有差異時請填寫原因" className="min-h-10 min-w-0 flex-1 rounded-lg border border-slate-300 px-3 text-sm" />
          <button type="button" disabled={Boolean(busyKey) || !view.vendorActionsEnabled || !String(disputeReasons[transfer.paymentId] || '').trim()}
            onClick={() => void performAction(`dispute-${transfer.paymentId}`, async () => {
              await readResponse(await apiClient.disputeVendorPayment({
                paymentId: transfer.paymentId, reason: disputeReasons[transfer.paymentId]
              }));
            })}
            className="min-h-10 rounded-lg border border-rose-300 px-3 py-2 text-sm font-bold text-rose-800 disabled:opacity-50">
            提出爭議
          </button>
        </div>
      )}
      {view.adminControls && transfer.status === 'DISPUTED' && (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <label className="sr-only" htmlFor={`resolve-${transfer.paymentId}`}>爭議處理結果</label>
          <input id={`resolve-${transfer.paymentId}`} type="text" maxLength={500}
            value={resolutions[transfer.paymentId] || ''}
            onChange={(event) => setResolutions((current) => ({ ...current, [transfer.paymentId]: event.target.value }))}
            placeholder="輸入處理結果" className="min-h-10 min-w-0 flex-1 rounded-lg border border-slate-300 px-3 text-sm" />
          <button type="button" disabled={Boolean(busyKey) || !String(resolutions[transfer.paymentId] || '').trim()}
            onClick={() => void performAction(`resolve-${transfer.paymentId}`, async () => {
              await readResponse(await apiClient.resolveVendorPaymentDispute({
                paymentId: transfer.paymentId, resolution: resolutions[transfer.paymentId]
              }));
            })}
            className="min-h-10 rounded-lg bg-slate-800 px-3 py-2 text-sm font-bold text-white disabled:opacity-50">
            記錄處理結果
          </button>
        </div>
      )}
      {view.adminControls && transfer.allocationId && transfer.status !== 'REVERSED' && (
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_2fr_auto]">
          <label className="sr-only" htmlFor={`adjust-${transfer.allocationId}`}>分攤修正金額</label>
          <input id={`adjust-${transfer.allocationId}`} type="number" step="1"
            value={adjustments[transfer.allocationId]?.deltaTwd || ''}
            onChange={(event) => setAdjustments((current) => ({
              ...current,
              [transfer.allocationId]: { ...current[transfer.allocationId], deltaTwd: event.target.value }
            }))}
            placeholder="修正金額（正負整數）" className="min-h-10 rounded-lg border border-slate-300 px-3 text-sm" />
          <label className="sr-only" htmlFor={`adjust-reason-${transfer.allocationId}`}>分攤修正原因</label>
          <input id={`adjust-reason-${transfer.allocationId}`} type="text" maxLength={500}
            value={adjustments[transfer.allocationId]?.reason || ''}
            onChange={(event) => setAdjustments((current) => ({
              ...current,
              [transfer.allocationId]: { ...current[transfer.allocationId], reason: event.target.value }
            }))}
            placeholder="修正原因" className="min-h-10 rounded-lg border border-slate-300 px-3 text-sm" />
          <button type="button" disabled={Boolean(busyKey)}
            onClick={() => void performAction(`adjust-${transfer.allocationId}`, async () => {
              const value = adjustments[transfer.allocationId] || {};
              await readResponse(await apiClient.adjustVendorPaymentAllocation({
                allocationId: transfer.allocationId,
                deltaTwd: Number(value.deltaTwd),
                reason: value.reason
              }));
            })}
            className="min-h-10 rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold disabled:opacity-50">
            記錄分攤更正
          </button>
        </div>
      )}
      {view.adminControls && transfer.isPrimaryTransferRow && transfer.status !== 'REVERSED' && (
        <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
          <label className="sr-only" htmlFor={`reverse-${transfer.paymentId}`}>整筆轉帳沖正原因</label>
          <input id={`reverse-${transfer.paymentId}`} type="text" maxLength={500}
            value={reversals[transfer.paymentId]?.reason || ''}
            onChange={(event) => setReversals((current) => ({
              ...current,
              [transfer.paymentId]: { ...current[transfer.paymentId], reason: event.target.value }
            }))}
            placeholder="整筆轉帳沖正原因" className="min-h-10 w-full rounded-lg border border-slate-300 px-3 text-sm" />
          <label className="flex min-h-10 items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={Boolean(reversals[transfer.paymentId]?.confirmed)}
              onChange={(event) => setReversals((current) => ({
                ...current,
                [transfer.paymentId]: { ...current[transfer.paymentId], confirmed: event.target.checked }
              }))} />
            我已核對原因，並確認將這筆轉帳的所有日期分攤沖正
          </label>
          <button type="button" disabled={Boolean(busyKey) || !String(reversals[transfer.paymentId]?.reason || '').trim() || !reversals[transfer.paymentId]?.confirmed}
            onClick={() => void performAction(`reverse-${transfer.paymentId}`, async () => {
              const value = reversals[transfer.paymentId] || {};
              await readResponse(await apiClient.reverseVendorPayment({
                paymentId: transfer.paymentId, reason: value.reason, confirmed: value.confirmed
              }));
              setReversals((current) => {
                const next = { ...current };
                delete next[transfer.paymentId];
                return next;
              });
            })}
            className="min-h-10 rounded-lg border border-rose-300 px-3 py-2 text-sm font-bold text-rose-800 disabled:opacity-50">
            沖正整筆轉帳
          </button>
        </div>
      )}
    </div>
  );

  const showToday = view.vendorLayout && tab === 'today';
  const showOrders = !view.vendorLayout || tab === 'orders';
  const showSettlement = !view.vendorLayout || tab === 'settlement';
  const today = taipeiToday();
  const todayDay = days.find((day) => day.serviceDate === today);
  const selectTab = (key) => {
    setTab(key);
    if (key === 'today' && month !== currentMonth()) setMonth(currentMonth());
    else if (key !== tab && !loading && (isVendor || vendorId)) void load();
  };
  const listedDays = days.filter((day) => (
    !view.vendorLayout
    || (tab === 'orders' && Number(day.orderCount || 0) > 0)
    || (tab === 'settlement' && (Number(day.settlement?.receivableTwd || 0) > 0
      || (day.settlement?.transfers || []).length > 0))
  ));

  return (
    <section aria-label={isVendor ? '廠商每日訂單與轉帳對帳' : '廠商每日訂單與轉帳管理'} className="mx-auto w-full max-w-xl space-y-4">
      {(isAdmin || mock || !view.vendorLayout) && <div className="rounded-2xl border border-emerald-900/10 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            {view.vendorLayout
              ? <h2 className="text-xl font-bold text-[#2C4A3E]">{vendorName || '載入中…'}</h2>
              : <>
                <h2 className="text-xl font-bold text-[#2C4A3E]">廠商訂單與轉帳</h2>
                <p className="mt-1 text-sm text-slate-600">{vendorName || (isAdmin ? '選擇廠商查看' : '依已授權廠商範圍顯示')}</p>
              </>}
          </div>
          {mock && <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-extrabold text-amber-900">LOCAL MOCK · 非 LINE／非實際 API</span>}
        </div>
        {(isAdmin || !showToday) && <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {isAdmin && <label className="space-y-1 text-sm font-medium text-slate-700">
            <span>廠商</span>
            <select value={vendorId} onChange={(event) => setVendorId(event.target.value)}
              className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3">
              <option value="">請選擇廠商</option>
              {vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>
                {isVendorEnabled(vendor) ? vendor.name : `${vendor.name}（已停用）`}
              </option>)}
            </select>
          </label>}
          {!showToday && <label className="space-y-1 text-sm font-medium text-slate-700">
            <span>月份（台北時間）</span>
            <input type="month" value={month} onChange={(event) => setMonth(event.target.value)}
              className="min-h-11 w-full rounded-lg border border-slate-300 px-3" />
          </label>}
        </div>}
        {isAdmin && <label className="mt-3 flex min-h-11 items-center gap-2 rounded-lg bg-slate-50 px-3 text-sm font-medium text-slate-700">
          <input type="checkbox" checked={vendorPreview} onChange={(event) => setVendorPreview(event.target.checked)} />
          以廠商視角預覽（唯讀）
        </label>}
      </div>}

      {view.vendorLayout && <div role="tablist" aria-label="廠商分頁" className="grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1">
        {VENDOR_TABS.map(({ key, label }) => <button key={key} type="button" role="tab" aria-selected={tab === key}
          onClick={() => selectTab(key)}
          className={`min-h-11 rounded-lg text-sm font-bold ${tab === key ? 'bg-white text-[#2C4A3E] shadow-sm' : 'text-slate-600'}`}>
          {label}
        </button>)}
      </div>}

      {view.vendorLayout && !isAdmin && !mock && !showToday && <label className="block space-y-1 rounded-2xl border border-emerald-900/10 bg-white p-4 text-sm font-medium text-slate-700 shadow-sm">
        <span>月份（台北時間）</span>
        <input type="month" value={month} onChange={(event) => setMonth(event.target.value)}
          className="min-h-11 w-full rounded-lg border border-slate-300 px-3" />
      </label>}

      {view.previewing && <p role="status" className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-950">
        廠商視角預覽：顯示{vendorName ? `「${vendorName}」` : '這家廠商'}登入後看到的畫面。管理功能已隱藏，「確認收到」與「提出爭議」只有廠商本人能操作。
      </p>}

      {role === 'Vendor' && readOnly && showSettlement && <p role="status" className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-950">
        目前是代號測試登入，只能查看。「確認收到」與「提出爭議」請用 LINE 登入後操作。
      </p>}

      {!error && showSettlement && <p className="text-xs text-slate-500">
        轉帳對帳與訂單履行狀態分開顯示。
      </p>}

      {view.adminControls && selectedVendor && !isVendorEnabled(selectedVendor) && (
        <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
          此廠商已停用；仍可檢視歷史對帳，但不能登記新轉帳。
        </p>
      )}

      {canRecordTransfer && (
        <form onSubmit={submitTransfer} className="space-y-3 rounded-2xl border border-emerald-900/10 bg-white p-4 shadow-sm">
          <div>
            <h3 className="font-bold text-[#2C4A3E]">{mock ? '模擬登記銀行轉帳（LOCAL MOCK）' : '登記已完成的銀行轉帳'}</h3>
            <p className="mt-1 text-sm text-slate-600">{mock
              ? '只建立本機瀏覽器中的合成測試紀錄，不連接銀行、Worker 或正式資料。'
              : '請先在銀行 App 實際轉帳，再記錄金額與日期。本系統不會執行付款，也不收集帳號或付款截圖。'}</p>
          </div>
          <label className="flex min-h-11 items-center gap-2 rounded-lg bg-amber-50 px-3 text-sm text-amber-950">
            <input type="checkbox" checked={actualTransferDone} onChange={(event) => {
              setActualTransferDone(event.target.checked);
              setDetailsReviewed(false);
            }} />
            {mock ? '我確認這是合成 Mock 轉帳' : '我已在銀行 App 完成這筆實際轉帳'}
          </label>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm font-medium text-slate-700"><span>{mock ? '模擬轉帳總額（元）' : '實際轉帳總額（元）'}</span>
              <input required min="1" step="1" type="number" inputMode="numeric" value={transferAmount}
                onChange={(event) => { setTransferAmount(event.target.value); clearTransferConfirmations(); }}
                className="min-h-11 w-full rounded-lg border border-slate-300 px-3" />
            </label>
            <label className="space-y-1 text-sm font-medium text-slate-700"><span>轉帳日期</span>
              <input required type="date" value={transferredOn} onChange={(event) => { setTransferredOn(event.target.value); clearTransferConfirmations(); }}
                className="min-h-11 w-full rounded-lg border border-slate-300 px-3" />
            </label>
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold text-slate-700">分攤至訂餐日期（可多日、各日部分付款）</legend>
            {allocations.map((allocation, index) => (
              <div key={index} className="grid grid-cols-[1.1fr_1fr_auto] gap-2">
                <label className="sr-only" htmlFor={`allocation-date-${index}`}>訂餐日期</label>
                <input id={`allocation-date-${index}`} required type="date" value={allocation.serviceDate}
                  onChange={(event) => updateAllocation(index, 'serviceDate', event.target.value)}
                  className="min-h-11 min-w-0 rounded-lg border border-slate-300 px-2 text-sm" />
                <label className="sr-only" htmlFor={`allocation-amount-${index}`}>此日分攤金額</label>
                <input id={`allocation-amount-${index}`} required min="1" step="1" type="number" inputMode="numeric"
                  value={allocation.amountTwd} onChange={(event) => updateAllocation(index, 'amountTwd', event.target.value)}
                  placeholder="分攤金額" className="min-h-11 min-w-0 rounded-lg border border-slate-300 px-2 text-sm" />
                <button type="button" onClick={() => removeAllocation(index)} disabled={allocations.length <= 1}
                  aria-label={`移除第 ${index + 1} 筆日期分攤`}
                  className="min-h-11 rounded-lg border border-slate-300 px-3 text-sm disabled:opacity-40">移除</button>
              </div>
            ))}
            <button type="button" onClick={addAllocation} disabled={allocations.length >= 31}
              className="min-h-10 rounded-lg border border-dashed border-slate-400 px-3 text-sm font-semibold disabled:opacity-50">＋ 增加訂餐日期</button>
          </fieldset>
          <label className="flex min-h-11 items-center gap-2 rounded-lg bg-slate-50 px-3 text-sm text-slate-700">
            <input type="checkbox" checked={detailsReviewed} onChange={(event) => setDetailsReviewed(event.target.checked)} />
            {mock ? '我已核對合成轉帳日期、總額及每筆日期分攤' : '我已再次核對轉帳日期、總額及每筆日期分攤'}
          </label>
          <button type="submit" disabled={Boolean(busyKey) || !actualTransferDone || !detailsReviewed}
            className="min-h-11 w-full rounded-lg bg-[#2C4A3E] px-4 py-2 font-bold text-white disabled:opacity-50">
            {busyKey === 'record-transfer' ? '登記中…' : mock ? '登記合成轉帳與日期分攤' : '登記轉帳與日期分攤'}
          </button>
        </form>
      )}

      {actionMessage && <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{actionMessage}</p>}
      {actionError && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-900">{actionError}</p>}
      {view.adminControls && selectedVendor && isVendorEnabled(selectedVendor) && (
        <VendorHistoryImport key={vendorId} vendorId={vendorId} vendorName={selectedVendor.name} onImported={() => void load()} />
      )}

      {error && <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
        <p>{error}</p><button type="button" onClick={() => void load()} className="mt-2 min-h-10 rounded-lg border border-rose-300 px-3 font-bold">重試</button>
      </div>}

      {!error && showToday && (
        <div aria-label="今日訂單" className="space-y-3">
          {!todayDay || Number(todayDay.orderCount || 0) === 0
            ? <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-600">
              {loading ? '載入中…' : `今天（${today}）目前沒有訂單。`}
            </div>
            : <VendorDaySummary day={todayDay} />}
        </div>
      )}

      {!error && showSettlement && <div aria-label="對帳合計" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {[
          ['應收', totals.receivable], ['已登記轉帳', totals.registered],
          ['未登記差額', totals.unregistered], ['待廠商確認', totals.pending],
          ['廠商已確認', totals.confirmed], ['爭議中', totals.disputed],
          ...(totals.historical > 0 ? [['歷史已結清', totals.historical]] : [])
        ].map(([label, value]) => <div key={label} className="rounded-xl border border-slate-200 bg-white p-3">
          <div className="text-xs text-slate-500">{label}</div><div className="mt-1 font-bold tabular-nums text-slate-800">{currency(value)}</div>
        </div>)}
      </div>}

      {!error && showOrders && <div aria-label="訂單月合計" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ['訂單日數', totals.orderDays, false], ['訂單數', totals.orders, false],
          ['份數', totals.portions, false], ['訂單金額', totals.amount, true]
        ].map(([label, value, money]) => <div key={label} className="rounded-xl border border-slate-200 bg-white p-3">
          <div className="text-xs text-slate-500">{label}</div><div className="mt-1 font-bold tabular-nums text-slate-800">{money ? currency(value) : value}</div>
        </div>)}
      </div>}

      {!loading && !error && !showToday && listedDays.length === 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-600">這個月份尚無訂單或轉帳紀錄。</div>
      )}
      {!showToday && <div className="space-y-3">
        {listedDays.map((day) => {
          const dayKey = `${day.vendorId}-${day.serviceDate}`;
          const expanded = expandedDays[dayKey] ?? (day.serviceDate === taipeiToday());
          return <article key={dayKey} className="rounded-2xl border border-emerald-900/10 bg-white p-4 shadow-sm">
          <button type="button" aria-expanded={expanded}
            onClick={() => setExpandedDays((current) => ({ ...current, [dayKey]: !expanded }))}
            className="flex min-h-12 w-full flex-wrap items-start justify-between gap-2 text-left">
            <span><span className="block text-lg font-bold text-[#2C4A3E]">{day.serviceDate} ・{day.vendorName}</span>
              <span className="text-sm text-slate-600">{showOrders
                ? `${day.orderCount} 筆訂單・${day.portionCount} 份・${currency(day.amountTwd)}`
                : `應收 ${currency(day.settlement?.receivableTwd)}・已登記 ${currency(day.settlement?.registeredTransferTwd)}`}</span></span>
            <span className="flex items-center gap-2">
              <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${day.cutoffPassed ? 'bg-emerald-100 text-emerald-900' : 'bg-amber-100 text-amber-900'}`}>
                {dayStatusLabel(day)}
              </span>
              <span aria-hidden="true" className="text-slate-500">{expanded ? '收合' : '展開'}</span>
            </span>
          </button>
          {expanded && <div className="mt-3 space-y-3">
          <p className="text-xs text-slate-500">截止時間：{formatTaipeiTime(day.cutoffAt)}</p>
          {day.changeReason && <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">版本原因：{reasonLabel(day.changeReason)}</p>}
          {showOrders && day.items?.length > 0 && <ul className="space-y-1 border-t border-slate-100 pt-2 text-sm">
            {day.items.map((item, index) => <li key={`${item.name}-${item.variantKey}-${index}`} className="flex justify-between gap-3">
              <span className="min-w-0 break-words">{vendorItemLabel(item)} × {item.quantity}</span>
              <span className="shrink-0 tabular-nums">{currency(item.amountTwd)}</span>
            </li>)}
          </ul>}
          {showSettlement && <section aria-label={`${day.serviceDate} 轉帳對帳`} className="space-y-2 border-t border-slate-100 pt-3">
            <h4 className="font-bold text-slate-800">轉帳對帳 <span className="text-xs font-normal text-slate-500">（與訂單履行狀態分開）</span></h4>
            <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
              <div className="rounded-lg bg-slate-50 p-2">應收<strong className="mt-1 block">{currency(day.settlement?.receivableTwd)}</strong></div>
              <div className="rounded-lg bg-slate-50 p-2">已登記<strong className="mt-1 block">{currency(day.settlement?.registeredTransferTwd)}</strong></div>
              <div className="rounded-lg bg-slate-50 p-2">未登記差額<strong className="mt-1 block">{currency(day.settlement?.unregisteredDifferenceTwd)}</strong></div>
              <div className="rounded-lg bg-slate-50 p-2">待廠商確認<strong className="mt-1 block">{currency(day.settlement?.pendingConfirmationTwd)}</strong></div>
              <div className="rounded-lg bg-slate-50 p-2">廠商已確認<strong className="mt-1 block">{currency(day.settlement?.confirmedTwd)}</strong></div>
              <div className="rounded-lg bg-slate-50 p-2">有異議<strong className="mt-1 block">{currency(day.settlement?.disputedTwd)}</strong></div>
            </div>
            {Number(day.settlement?.overAllocatedTwd) > 0 && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-950">分攤高於目前應收 {currency(day.settlement.overAllocatedTwd)}，請管理員追加具原因的分攤更正。</p>}
            {(day.settlement?.transfers || []).length > 0
              ? <div className="space-y-2">{day.settlement.transfers.map((transfer) => makePaymentAction(day, transfer))}</div>
              : <p className="text-sm text-slate-500">尚無已登記轉帳；截止前金額是估算值。</p>}
          </section>}
          </div>}
        </article>;
        })}
      </div>}
    </section>
  );
}

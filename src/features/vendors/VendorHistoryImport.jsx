import React, { useState } from 'react';
import { apiClient } from '../../api/apiClient';
import { formatApiErrorDiagnostic } from '../../api/apiErrors';

const readJson = async (response) => {
  let data = {};
  try { data = await response.json(); } catch { /* reported below */ }
  if (!response.ok || data?.success === false || data?.error) {
    const error = new Error(data?.error || `HTTP ${response.status}`);
    error.code = data?.error || 'VENDOR_HISTORY_IMPORT_FAILED';
    error.requestId = response.headers?.get?.('X-Request-Id') || data?.requestId || null;
    throw error;
  }
  return data;
};

// Admin-only: confirm that a vendor's past menu versions belong to it, so its
// legacy orders show up for the vendor. Those days are shown as settled on
// the day; no payment records are created.
export default function VendorHistoryImport({ vendorId, vendorName, onImported }) {
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const loadPreview = async () => {
    setBusy(true); setError(''); setMessage('');
    try {
      setPreview(await readJson(await apiClient.getVendorHistoryImport({ vendorId })));
    } catch (requestError) {
      setError(`無法查詢可匯入的過往訂單。${formatApiErrorDiagnostic(requestError)}`);
    } finally { setBusy(false); }
  };

  const apply = async () => {
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await readJson(await apiClient.applyVendorHistoryImport({
        vendorId, expectedVersions: preview.versionCount
      }));
      setMessage(`已匯入 ${result.importedVersions} 個菜單版本的過往訂單。`);
      setPreview(null);
      onImported?.();
    } catch (requestError) {
      setError(requestError.code === 'VENDOR_HISTORY_PREVIEW_STALE'
        ? '資料已變動，請重新查詢後再匯入。'
        : `匯入失敗。${formatApiErrorDiagnostic(requestError)}`);
    } finally { setBusy(false); }
  };

  return <section aria-label="匯入過往訂單" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
    <h3 className="font-bold text-[#2C4A3E]">匯入過往訂單</h3>
    <p className="mt-1 text-xs text-slate-500">把「{vendorName || '這家廠商'}」系統上線前的訂單算進廠商訂單總覽。這些日子會顯示為「歷史已結清」，不會產生轉帳紀錄。</p>
    {!preview && <button type="button" disabled={busy || !vendorId} onClick={() => void loadPreview()}
      className="mt-3 min-h-11 w-full rounded-xl border border-[#2C4A3E] px-4 font-bold text-[#2C4A3E] disabled:opacity-50">
      {busy ? '查詢中…' : '查詢可匯入的過往訂單'}
    </button>}
    {preview && (preview.versionCount === 0
      ? <p role="status" className="mt-3 text-sm text-slate-700">目前沒有可匯入的過往菜單版本。</p>
      : <div role="status" className="mt-3 space-y-2 text-sm text-slate-800">
        <p>可匯入 {preview.versionCount} 個菜單版本（{preview.firstVersionDate} ～ {preview.lastVersionDate}）。</p>
        <p>約 {preview.orderCount} 筆訂單、{preview.dayCount} 天{preview.firstOrderDate ? `（${preview.firstOrderDate} ～ ${preview.lastOrderDate}）` : ''}。</p>
        <div className="flex gap-2">
          <button type="button" disabled={busy} onClick={() => void apply()}
            className="min-h-11 flex-1 rounded-xl bg-[#2C4A3E] px-4 font-bold text-white disabled:opacity-50">
            {busy ? '匯入中…' : '確認匯入'}
          </button>
          <button type="button" disabled={busy} onClick={() => setPreview(null)}
            className="min-h-11 rounded-xl border border-slate-300 px-4 font-bold text-slate-700">取消</button>
        </div>
      </div>)}
    {message && <p role="status" className="mt-3 text-sm text-emerald-800">{message}</p>}
    {error && <p role="alert" className="mt-3 text-sm text-rose-800">{error}</p>}
  </section>;
}

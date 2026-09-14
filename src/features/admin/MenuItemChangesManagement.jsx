import React, { useMemo, useState } from 'react';

const EMPTY_DRAFT = Object.freeze({
  effective_date: '2026-09-11',
  vendor: '蔡老師',
  item_code: '',
  variant_key: '',
  item_name: '',
  price: '',
  enabled: true,
  image_url: '',
  note: '',
  display_order: 0
});

const inputClass = 'w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs focus:outline-emerald-600 disabled:bg-gray-100';

const rowIdentity = (row) => `${row.vendor}\u0000${row.item_code}\u0000${row.variant_key || ''}`;

const errorText = (error) => {
  if (error?.code === 'MENU_CHANGE_DUPLICATE') return '同一生效日、供應商、品項代號與 variant 已存在。請以較晚生效日新增修正。';
  if (error?.code === 'MENU_CHANGE_EFFECTIVE_DATE_BEFORE_CUTOFF') return '手動變更只能從 2026-09-11 起建立。';
  return error?.message || '操作失敗，請稍後再試。';
};

const PreviewImage = ({ url, alt }) => (
  url ? (
    <img
      src={url}
      alt={alt || '圖片預覽'}
      className="h-10 w-10 rounded-lg border border-gray-200 object-cover"
      onError={(event) => { event.currentTarget.style.opacity = '0.25'; }}
    />
  ) : <span className="text-xs text-gray-300">無圖</span>
);

export default function MenuItemChangesManagement({
  changes = [],
  loading = false,
  error = '',
  isViewAsMode = false,
  onRefresh,
  onCreate,
  onPreview
}) {
  const [vendorFilter, setVendorFilter] = useState('');
  const [queryFilter, setQueryFilter] = useState('');
  const [monthFilter, setMonthFilter] = useState('');
  const [draft, setDraft] = useState(null);
  const [draftError, setDraftError] = useState('');
  const [saving, setSaving] = useState(false);
  const [historyIdentity, setHistoryIdentity] = useState('');
  const [previewVendor, setPreviewVendor] = useState('蔡老師');
  const [previewDate, setPreviewDate] = useState('2026-09-11');
  const [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState('');

  const visibleChanges = useMemo(() => {
    const vendor = vendorFilter.trim().toLocaleLowerCase();
    const query = queryFilter.trim().toLocaleLowerCase();
    return changes.filter((row) => (
      (!vendor || String(row.vendor || '').toLocaleLowerCase().includes(vendor))
      && (!query || `${row.item_code || ''} ${row.item_name || ''}`.toLocaleLowerCase().includes(query))
      && (!monthFilter || String(row.effective_date || '').startsWith(monthFilter))
    ));
  }, [changes, monthFilter, queryFilter, vendorFilter]);

  const historyCounts = useMemo(() => {
    const counts = new Map();
    changes.forEach((row) => counts.set(rowIdentity(row), (counts.get(rowIdentity(row)) || 0) + 1));
    return counts;
  }, [changes]);

  const selectedHistory = useMemo(() => (
    historyIdentity ? changes
      .filter((row) => rowIdentity(row) === historyIdentity)
      .sort((left, right) => String(right.effective_date).localeCompare(String(left.effective_date))) : []
  ), [changes, historyIdentity]);

  const updateDraft = (field, value) => setDraft((current) => ({ ...current, [field]: value }));

  const submitDraft = async (event) => {
    event.preventDefault();
    if (!draft || isViewAsMode || saving) return;
    setSaving(true);
    setDraftError('');
    try {
      await onCreate({
        ...draft,
        price: Number(draft.price),
        display_order: Number(draft.display_order || 0)
      });
      setDraft(null);
      if (onRefresh) await onRefresh();
    } catch (requestError) {
      setDraftError(errorText(requestError));
    } finally {
      setSaving(false);
    }
  };

  const loadPreview = async (event) => {
    event.preventDefault();
    setPreviewError('');
    try {
      const result = await onPreview({ vendor: previewVendor, targetDate: previewDate });
      setPreview(result);
    } catch (requestError) {
      setPreviewError(errorText(requestError));
    }
  };

  return (
    <section className="space-y-4">
      <div className="rounded-2xl border border-emerald-900/10 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-[#2C4A3E]">菜單品項維護</h2>
            <p className="mt-1 text-xs leading-5 text-gray-500">
              變更歷程採 append-only。SQL/GAS 匯入列唯讀；修正請新增較晚生效日的變更列。
            </p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onRefresh} disabled={loading || isViewAsMode} className="rounded-xl bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800 disabled:opacity-50">
              重新整理
            </button>
            <button type="button" onClick={() => { setDraft({ ...EMPTY_DRAFT }); setDraftError(''); }} disabled={isViewAsMode || Boolean(draft)} className="rounded-xl bg-[#2C4A3E] px-3 py-2 text-xs font-bold text-white disabled:bg-gray-300">
              新增變更列
            </button>
          </div>
        </div>
        {error && <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>}
        {draft && (
          <form onSubmit={submitDraft} className="mt-4 rounded-xl border border-amber-200 bg-amber-50/50 p-3">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-bold text-amber-900">本機草稿（尚未儲存）</h3>
              <button type="button" onClick={() => setDraft(null)} disabled={saving} className="text-xs font-bold text-gray-500">取消</button>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <label className="text-[11px] font-bold text-gray-600">生效日<input required type="date" min="2026-09-11" value={draft.effective_date} onChange={(event) => updateDraft('effective_date', event.target.value)} className={inputClass} disabled={saving} /></label>
              <label className="text-[11px] font-bold text-gray-600">供應商<input required value={draft.vendor} onChange={(event) => updateDraft('vendor', event.target.value)} className={inputClass} disabled={saving} /></label>
              <label className="text-[11px] font-bold text-gray-600">品項代號<input required value={draft.item_code} onChange={(event) => updateDraft('item_code', event.target.value)} className={inputClass} disabled={saving} /></label>
              <label className="text-[11px] font-bold text-gray-600">variant_key<input value={draft.variant_key} onChange={(event) => updateDraft('variant_key', event.target.value)} className={inputClass} disabled={saving} /></label>
              <label className="text-[11px] font-bold text-gray-600 sm:col-span-2">品名<input required value={draft.item_name} onChange={(event) => updateDraft('item_name', event.target.value)} className={inputClass} disabled={saving} /></label>
              <label className="text-[11px] font-bold text-gray-600">簽名價格<input required type="number" value={draft.price} onChange={(event) => updateDraft('price', event.target.value)} className={inputClass} disabled={saving} /></label>
              <label className="flex items-center gap-2 pt-5 text-[11px] font-bold text-gray-600"><input type="checkbox" checked={draft.enabled} onChange={(event) => updateDraft('enabled', event.target.checked)} disabled={saving} />啟用</label>
              <label className="text-[11px] font-bold text-gray-600 sm:col-span-2">圖片 URL<input type="url" value={draft.image_url} onChange={(event) => updateDraft('image_url', event.target.value)} placeholder="https://..." className={inputClass} disabled={saving} /></label>
              <div className="flex items-end gap-2 pb-1"><PreviewImage url={draft.image_url} alt={draft.item_name} /><span className="text-[11px] text-gray-500">儲存前預覽</span></div>
              <label className="text-[11px] font-bold text-gray-600 sm:col-span-4">備註<textarea value={draft.note} onChange={(event) => updateDraft('note', event.target.value)} className={`${inputClass} min-h-12`} disabled={saving} /></label>
            </div>
            {draftError && <p className="mt-2 text-xs text-rose-700">{draftError}</p>}
            <button type="submit" disabled={saving || isViewAsMode} className="mt-3 rounded-xl bg-amber-700 px-4 py-2 text-xs font-bold text-white disabled:bg-gray-300">{saving ? '儲存中...' : 'POST 儲存變更'}</button>
          </form>
        )}
      </div>

      <div className="rounded-2xl border border-emerald-900/10 bg-white p-4 shadow-sm">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <label className="text-xs font-bold text-gray-600">供應商<input value={vendorFilter} onChange={(event) => setVendorFilter(event.target.value)} className={inputClass} placeholder="篩選供應商" /></label>
          <label className="text-xs font-bold text-gray-600">代號 / 品名<input value={queryFilter} onChange={(event) => setQueryFilter(event.target.value)} className={inputClass} placeholder="搜尋" /></label>
          <label className="text-xs font-bold text-gray-600">月份<input type="month" value={monthFilter} onChange={(event) => setMonthFilter(event.target.value)} className={inputClass} /></label>
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[1050px] border-collapse text-xs">
            <thead><tr className="border-b border-gray-200 text-left text-gray-500"><th className="p-2">生效日</th><th className="p-2">供應商</th><th className="p-2">品項代號</th><th className="p-2">variant</th><th className="p-2">品名</th><th className="p-2">價格</th><th className="p-2">啟用</th><th className="p-2">圖片</th><th className="p-2">備註</th><th className="p-2">來源</th><th className="p-2">更新時間</th></tr></thead>
            <tbody>
              {loading ? <tr><td colSpan="11" className="p-6 text-center text-gray-400">讀取菜單歷程中...</td></tr> : visibleChanges.length === 0 ? <tr><td colSpan="11" className="p-6 text-center text-gray-400">目前沒有符合條件的變更列</td></tr> : visibleChanges.map((row) => (
                <tr key={row.menu_item_change_id} className="border-b border-gray-100 align-top hover:bg-emerald-50/30">
                  <td className="p-2 whitespace-nowrap">{row.effective_date}</td><td className="p-2">{row.vendor}</td><td className="p-2 font-bold">{row.item_code}</td><td className="p-2">{row.variant_key || '—'}</td><td className="p-2">{row.item_name}<div className="mt-1 text-[10px] text-gray-400">歷程 {historyCounts.get(rowIdentity(row)) || 1} 筆</div></td><td className="p-2 font-mono">{row.price}</td><td className="p-2">{row.enabled ? '啟用' : '停用'}</td><td className="p-2"><PreviewImage url={row.image_url} alt={row.item_name} /></td><td className="max-w-44 whitespace-pre-wrap p-2 text-gray-600">{row.note || '—'}</td><td className="p-2"><span className="rounded-full bg-gray-100 px-2 py-1 text-[10px] font-bold">{row.source_kind}</span></td><td className="p-2 whitespace-nowrap text-gray-500"><button type="button" onClick={() => setHistoryIdentity(rowIdentity(row))} className="mr-2 text-emerald-700 underline">查看歷程</button>{row.updated_at || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {historyIdentity && <div className="mt-3 rounded-xl border border-emerald-100 bg-emerald-50/40 p-3"><div className="flex items-center justify-between"><h3 className="text-xs font-bold text-emerald-900">品項歷程（唯讀）</h3><button type="button" onClick={() => setHistoryIdentity('')} className="text-xs text-gray-500">關閉</button></div><div className="mt-2 space-y-1">{selectedHistory.map((row) => <div key={row.menu_item_change_id} className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-700"><span>{row.effective_date}</span><span>{row.source_kind}</span><span>{row.enabled ? '啟用' : '停用'}</span><span className="font-mono">{row.price}</span><span>{row.note || '—'}</span></div>)}</div></div>}
      </div>

      <form onSubmit={loadPreview} className="rounded-2xl border border-indigo-900/10 bg-indigo-50/40 p-4 shadow-sm">
        <div className="flex flex-wrap items-end gap-2">
          <div><h3 className="text-sm font-bold text-indigo-950">指定日期菜單預覽</h3><p className="mt-1 text-xs text-indigo-900/60">與顧客選單、訂單驗證共用生效日解析規則。</p></div>
          <label className="text-xs font-bold text-gray-600">供應商<input value={previewVendor} onChange={(event) => setPreviewVendor(event.target.value)} className={inputClass} /></label>
          <label className="text-xs font-bold text-gray-600">日期<input required type="date" value={previewDate} onChange={(event) => setPreviewDate(event.target.value)} className={inputClass} /></label>
          <button type="submit" className="rounded-xl bg-indigo-700 px-3 py-2 text-xs font-bold text-white">預覽</button>
        </div>
        {previewError && <p className="mt-2 text-xs text-rose-700">{previewError}</p>}
        {preview && <div className="mt-3 rounded-xl bg-white p-3 text-xs"><p className="font-bold text-indigo-900">{preview.authority} · 可選 {preview.selectableItems?.length || 0} 項 / 完整狀態 {preview.items?.length || 0} 項</p><div className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2">{(preview.items || []).map((item) => <div key={`${item.item_code}-${item.variant_key}`} className="flex items-center gap-2 rounded-lg border border-gray-100 p-2"><PreviewImage url={item.image_url} alt={item.item_name} /><span className="min-w-0 flex-1 truncate">{item.item_code}{item.variant_key ? ` (${item.variant_key})` : ''} · {item.item_name}</span><span className="font-mono">{item.price}</span><span className={item.enabled ? 'text-emerald-700' : 'text-gray-400'}>{item.enabled ? '啟用' : '停用'}</span></div>)}</div></div>}
      </form>
    </section>
  );
}

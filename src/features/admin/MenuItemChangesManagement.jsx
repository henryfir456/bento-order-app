import React, { useMemo, useState } from 'react';
import { formatDateInput } from '../../dateUtils';

const inputClass = 'w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs focus:outline-emerald-600 disabled:bg-gray-100';
const HISTORY_MIN_DATE = '2026-09-11';

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

const Status = ({ enabled }) => (
  <span className={enabled ? 'font-bold text-emerald-700' : 'font-bold text-gray-400'}>
    {enabled ? '啟用' : '停用'}
  </span>
);

export default function MenuItemChangesManagement({
  changes = [],
  vendorOptions = [],
  loading = false,
  error = '',
  isViewAsMode = false,
  onRefresh,
  onCreate,
  onPreview
}) {
  const [activeView, setActiveView] = useState('current');
  const [historyVendor, setHistoryVendor] = useState('');
  const [queryFilter, setQueryFilter] = useState('');
  const [monthFilter, setMonthFilter] = useState('');
  const [draft, setDraft] = useState(null);
  const [draftError, setDraftError] = useState('');
  const [saving, setSaving] = useState(false);
  const [historyIdentity, setHistoryIdentity] = useState('');
  const [currentVendor, setCurrentVendor] = useState('');
  const [currentDate, setCurrentDate] = useState(() => formatDateInput());
  const [currentMenu, setCurrentMenu] = useState(null);
  const [currentMenuLoading, setCurrentMenuLoading] = useState(false);
  const [currentMenuError, setCurrentMenuError] = useState('');

  const normalizedVendorOptions = useMemo(() => Array.from(new Set(
    vendorOptions
      .map((vendor) => String(vendor || '').trim())
      .filter(Boolean)
  )), [vendorOptions]);

  const selectedCurrentVendor = normalizedVendorOptions.includes(currentVendor)
    ? currentVendor
    : normalizedVendorOptions[0] || '';

  const visibleChanges = useMemo(() => {
    const vendor = historyVendor.trim();
    const query = queryFilter.trim().toLocaleLowerCase();
    return changes.filter((row) => (
      (!vendor || String(row.vendor || '') === vendor)
      && (!query || `${row.item_code || ''} ${row.item_name || ''}`.toLocaleLowerCase().includes(query))
      && (!monthFilter || String(row.effective_date || '').startsWith(monthFilter))
    ));
  }, [changes, historyVendor, monthFilter, queryFilter]);

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

  const currentItems = currentMenu?.items || [];

  const updateDraft = (field, value) => setDraft((current) => ({ ...current, [field]: value }));

  const startDraft = (row = null) => {
    setDraft({
      effective_date: row?.effective_date || currentDate || formatDateInput(),
      vendor: row?.vendor || selectedCurrentVendor,
      item_code: row?.item_code || '',
      variant_key: row?.variant_key || '',
      item_name: row?.item_name || '',
      price: row?.price ?? '',
      enabled: row ? Boolean(row.enabled) : true,
      image_url: row?.image_url || '',
      note: row?.note || '',
      display_order: row?.display_order || 0
    });
    setDraftError('');
  };

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

  const loadCurrentMenu = async (event) => {
    event.preventDefault();
    if (!selectedCurrentVendor || !currentDate) {
      setCurrentMenuError('請先選擇供應商與日期。');
      return;
    }
    setCurrentMenuLoading(true);
    setCurrentMenuError('');
    try {
      const result = await onPreview({ vendor: selectedCurrentVendor, targetDate: currentDate });
      if (!Array.isArray(result?.items)) throw new Error('目前無法取得有效菜單。');
      setCurrentMenu(result);
    } catch (requestError) {
      setCurrentMenu(null);
      setCurrentMenuError(errorText(requestError));
    } finally {
      setCurrentMenuLoading(false);
    }
  };

  const changeCurrentVendor = (value) => {
    setCurrentVendor(value);
    setCurrentMenu(null);
    setCurrentMenuError('');
  };

  const changeCurrentDate = (value) => {
    setCurrentDate(value);
    setCurrentMenu(null);
    setCurrentMenuError('');
  };

  return (
    <section className="min-w-0 space-y-4">
      <div className="min-w-0 rounded-2xl border border-emerald-900/10 bg-white p-4 shadow-sm">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-[#2C4A3E]">菜單品項維護</h2>
            <p className="mt-1 text-xs leading-5 text-gray-500">
              目前菜單與正式點餐頁共用同一套 vendor／日期 resolver；變更歷程採 append-only。
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <button type="button" onClick={onRefresh} disabled={loading || isViewAsMode} className="rounded-xl bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800 disabled:opacity-50">
              重新整理
            </button>
            <button type="button" onClick={() => startDraft()} disabled={isViewAsMode || Boolean(draft)} className="rounded-xl bg-[#2C4A3E] px-3 py-2 text-xs font-bold text-white disabled:bg-gray-300">
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
              <label className="text-[11px] font-bold text-gray-600">生效日<input required type="date" min={HISTORY_MIN_DATE} value={draft.effective_date} onChange={(event) => updateDraft('effective_date', event.target.value)} className={inputClass} disabled={saving} /></label>
              <label className="text-[11px] font-bold text-gray-600">供應商<select required value={draft.vendor} onChange={(event) => updateDraft('vendor', event.target.value)} className={inputClass} disabled={saving || !normalizedVendorOptions.length}><option value="">請選擇</option>{normalizedVendorOptions.map((vendor) => <option key={vendor} value={vendor}>{vendor}</option>)}</select></label>
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
            <button type="submit" disabled={saving || isViewAsMode || !draft.vendor} className="mt-3 rounded-xl bg-amber-700 px-4 py-2 text-xs font-bold text-white disabled:bg-gray-300">{saving ? '儲存中...' : 'POST 儲存變更'}</button>
          </form>
        )}
      </div>

      <div className="min-w-0 rounded-2xl border border-emerald-900/10 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap gap-2 border-b border-gray-100 pb-3" role="tablist" aria-label="菜單維護檢視">
          <button type="button" role="tab" aria-selected={activeView === 'current'} onClick={() => setActiveView('current')} className={`rounded-xl px-3 py-2 text-xs font-bold ${activeView === 'current' ? 'bg-emerald-700 text-white' : 'bg-emerald-50 text-emerald-800'}`}>
            目前菜單
          </button>
          <button type="button" role="tab" aria-selected={activeView === 'history'} onClick={() => setActiveView('history')} className={`rounded-xl px-3 py-2 text-xs font-bold ${activeView === 'history' ? 'bg-emerald-700 text-white' : 'bg-emerald-50 text-emerald-800'}`}>
            變更歷程
          </button>
        </div>

        {activeView === 'current' ? (
          <div className="pt-3">
            <form onSubmit={loadCurrentMenu} className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
              <label className="text-xs font-bold text-gray-600">供應商<select required value={selectedCurrentVendor} onChange={(event) => changeCurrentVendor(event.target.value)} className={inputClass} disabled={!normalizedVendorOptions.length || currentMenuLoading}><option value="">請選擇供應商</option>{normalizedVendorOptions.map((vendor) => <option key={vendor} value={vendor}>{vendor}</option>)}</select></label>
              <label className="text-xs font-bold text-gray-600">日期<input required type="date" value={currentDate} onChange={(event) => changeCurrentDate(event.target.value)} className={inputClass} disabled={currentMenuLoading} /></label>
              <button type="submit" disabled={!selectedCurrentVendor || currentMenuLoading} className="rounded-xl bg-indigo-700 px-3 py-2 text-xs font-bold text-white disabled:bg-gray-300">{currentMenuLoading ? '查詢中...' : '查詢目前菜單'}</button>
            </form>
            <p className="mt-2 text-xs text-gray-500">已選定 {selectedCurrentVendor || '供應商'} · {currentDate}；結果等同該日期使用者可點到的 canonical menu。</p>
            {currentMenuError && <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{currentMenuError}</p>}
            {currentMenu && (
              <div className="mt-3">
                <p className="mb-2 text-xs font-bold text-indigo-900">{currentMenu.authority} · 可點選 {currentMenu.selectableItems?.length || 0} 項 / 有效狀態 {currentItems.length} 項</p>
                <div className="hidden overflow-hidden rounded-xl border border-gray-100 sm:block">
                  <table className="w-full table-fixed border-collapse text-xs">
                    <thead><tr className="border-b border-gray-200 bg-gray-50 text-left text-gray-500"><th className="w-[15%] p-2">品項代號</th><th className="w-[15%] p-2">variant</th><th className="w-[25%] p-2">品名</th><th className="w-[12%] p-2">價格</th><th className="w-[15%] p-2">生效日</th><th className="w-[10%] p-2">狀態</th><th className="w-[8%] p-2">操作</th></tr></thead>
                    <tbody>{currentItems.map((row) => <tr key={`${row.item_code}-${row.variant_key}`} className="border-b border-gray-100 align-top last:border-0"><td className="break-words p-2 font-bold">{row.item_code}</td><td className="break-words p-2">{row.variant_key || '—'}</td><td className="break-words p-2">{row.item_name}</td><td className="p-2 font-mono">{row.price}</td><td className="break-words p-2">{row.effective_date}</td><td className="p-2"><Status enabled={row.enabled} /></td><td className="p-2"><button type="button" onClick={() => startDraft(row)} disabled={isViewAsMode || Boolean(draft)} className="text-indigo-700 underline disabled:text-gray-300">建立變更</button></td></tr>)}</tbody>
                  </table>
                </div>
                <div className="space-y-2 sm:hidden">{currentItems.map((row) => <article key={`${row.item_code}-${row.variant_key}`} className="rounded-xl border border-gray-100 p-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="break-words font-bold text-gray-800">{row.item_code}{row.variant_key ? ` · ${row.variant_key}` : ''}</p><p className="mt-1 break-words text-sm text-gray-700">{row.item_name}</p></div><Status enabled={row.enabled} /></div><dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-gray-500"><div><dt>價格</dt><dd className="font-mono text-gray-800">{row.price}</dd></div><div><dt>生效日</dt><dd className="text-gray-800">{row.effective_date}</dd></div><div className="col-span-2"><dt>來源</dt><dd className="break-words text-gray-800">{row.source_kind || '—'}</dd></div></dl><button type="button" onClick={() => startDraft(row)} disabled={isViewAsMode || Boolean(draft)} className="mt-2 text-xs font-bold text-indigo-700 underline disabled:text-gray-300">建立變更</button></article>)}</div>
                {currentItems.length === 0 && <p className="rounded-xl border border-dashed border-gray-200 p-6 text-center text-xs text-gray-400">該日期沒有可顯示的有效菜單列。</p>}
              </div>
            )}
          </div>
        ) : (
          <div className="pt-3">
            <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-3">
              <label className="text-xs font-bold text-gray-600">供應商<select value={historyVendor} onChange={(event) => setHistoryVendor(event.target.value)} className={inputClass}><option value="">全部供應商</option>{normalizedVendorOptions.map((vendor) => <option key={vendor} value={vendor}>{vendor}</option>)}</select></label>
              <label className="text-xs font-bold text-gray-600">代號 / 品名<input value={queryFilter} onChange={(event) => setQueryFilter(event.target.value)} className={inputClass} placeholder="搜尋" /></label>
              <label className="text-xs font-bold text-gray-600">月份<input type="month" value={monthFilter} onChange={(event) => setMonthFilter(event.target.value)} className={inputClass} /></label>
            </div>
            <div className="mt-3 hidden overflow-hidden rounded-xl border border-gray-100 sm:block">
              <table className="w-full table-fixed border-collapse text-xs">
                <thead><tr className="border-b border-gray-200 bg-gray-50 text-left text-gray-500"><th className="w-[13%] p-2">生效日</th><th className="w-[14%] p-2">品項代號</th><th className="w-[13%] p-2">variant</th><th className="w-[22%] p-2">品名</th><th className="w-[10%] p-2">價格</th><th className="w-[10%] p-2">狀態</th><th className="w-[10%] p-2">來源</th><th className="w-[8%] p-2">操作</th></tr></thead>
                <tbody>{loading ? <tr><td colSpan="8" className="p-6 text-center text-gray-400">讀取菜單歷程中...</td></tr> : visibleChanges.length === 0 ? <tr><td colSpan="8" className="p-6 text-center text-gray-400">目前沒有符合條件的變更列</td></tr> : visibleChanges.map((row) => <tr key={row.menu_item_change_id} className="border-b border-gray-100 align-top last:border-0"><td className="break-words p-2">{row.effective_date}</td><td className="break-words p-2 font-bold">{row.item_code}</td><td className="break-words p-2">{row.variant_key || '—'}</td><td className="break-words p-2">{row.item_name}<div className="mt-1 text-[10px] text-gray-400">歷程 {historyCounts.get(rowIdentity(row)) || 1} 筆</div></td><td className="p-2 font-mono">{row.price}</td><td className="p-2"><Status enabled={row.enabled} /></td><td className="break-words p-2"><span className="rounded-full bg-gray-100 px-2 py-1 text-[10px] font-bold">{row.source_kind}</span></td><td className="break-words p-2"><button type="button" onClick={() => setHistoryIdentity(rowIdentity(row))} className="text-emerald-700 underline">查看</button></td></tr>)}</tbody>
              </table>
            </div>
            <div className="mt-3 space-y-2 sm:hidden">{loading ? <p className="p-6 text-center text-xs text-gray-400">讀取菜單歷程中...</p> : visibleChanges.length === 0 ? <p className="p-6 text-center text-xs text-gray-400">目前沒有符合條件的變更列</p> : visibleChanges.map((row) => <article key={row.menu_item_change_id} className="rounded-xl border border-gray-100 p-3"><div className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500"><span>{row.effective_date}</span><span className="rounded-full bg-gray-100 px-2 py-1 text-[10px] font-bold">{row.source_kind}</span><Status enabled={row.enabled} /></div><p className="mt-2 break-words font-bold text-gray-800">{row.item_code}{row.variant_key ? ` · ${row.variant_key}` : ''}</p><p className="mt-1 break-words text-sm text-gray-700">{row.item_name}</p><div className="mt-2 flex items-center gap-3 text-xs text-gray-500"><span className="font-mono text-gray-800">{row.price}</span><PreviewImage url={row.image_url} alt={row.item_name} /></div>{row.note && <p className="mt-2 break-words whitespace-pre-wrap text-xs text-gray-600">{row.note}</p>}<button type="button" onClick={() => setHistoryIdentity(rowIdentity(row))} className="mt-2 text-xs font-bold text-emerald-700 underline">查看此品項歷程（{historyCounts.get(rowIdentity(row)) || 1} 筆）</button></article>)}</div>
            {historyIdentity && <div className="mt-3 rounded-xl border border-emerald-100 bg-emerald-50/40 p-3"><div className="flex items-center justify-between"><h3 className="text-xs font-bold text-emerald-900">品項歷程（唯讀）</h3><button type="button" onClick={() => setHistoryIdentity('')} className="text-xs text-gray-500">關閉</button></div><div className="mt-2 space-y-1">{selectedHistory.map((row) => <div key={row.menu_item_change_id} className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-700"><span>{row.effective_date}</span><span>{row.source_kind}</span><Status enabled={row.enabled} /><span className="font-mono">{row.price}</span><span className="break-words">{row.note || '—'}</span></div>)}</div></div>}
          </div>
        )}
      </div>
    </section>
  );
}

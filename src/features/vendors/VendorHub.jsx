import { useState } from 'react';
import Modal from '../../components/Modal';
import {
  formatVendorCutoff,
  formatVendorDate,
  isHttpUrl,
  latestVendorOrderingGroup,
  normalizeVendor
} from './vendorModel';

const formFromVendor = (vendor) => ({
  description: vendor?.description || '',
  phone: vendor?.phone || '',
  address: vendor?.address || '',
  website_url: vendor?.website_url || '',
  menu_source_url: vendor?.menu_source_url || '',
  menu_image_url: vendor?.menu_image_url || '',
  menu_updated_at: vendor?.menu_updated_at || '',
  enabled: vendor?.enabled !== false
});

const validateForm = (form) => {
  for (const field of ['website_url', 'menu_source_url', 'menu_image_url']) {
    if (!isHttpUrl(form[field])) return '網址必須使用 http 或 https。';
  }
  if (form.menu_updated_at && !/^\d{4}-\d{2}-\d{2}$/.test(form.menu_updated_at)) {
    return '請輸入有效的菜單更新日期。';
  }
  return '';
};

const errorMessage = (error, fallback) => (
  error?.code ? `${fallback}（${error.code}）。` : (error?.message || fallback)
);

const inputClass = 'w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-normal focus:outline-emerald-600 disabled:bg-gray-100';

function VendorList({
  vendors,
  loading,
  error,
  onRetry,
  onSelectVendor,
  onBackToCalendar
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-[#2C4A3E]">店家專區</h2>
          <p className="mt-1 text-xs text-gray-500">查看店家資訊與最新菜單。</p>
        </div>
        <button type="button" onClick={onBackToCalendar} className="rounded-xl border border-emerald-200 px-3 py-2 text-xs font-bold text-emerald-800 transition hover:bg-emerald-50">← 月曆</button>
      </div>
      {error && (
        <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          <p>{error}</p>
          <button type="button" onClick={onRetry} className="mt-3 rounded-xl bg-rose-700 px-3 py-2 text-xs font-bold text-white">重新整理</button>
        </div>
      )}
      {loading ? (
        <div className="rounded-2xl border border-emerald-900/10 bg-white p-6 text-center text-sm text-emerald-800 animate-pulse">讀取店家資料中...</div>
      ) : vendors.length === 0 ? (
        <div className="rounded-2xl border border-emerald-900/10 bg-white p-6 text-center text-sm text-gray-400">目前沒有可顯示的店家資料。</div>
      ) : (
        <div className="space-y-3">
          {vendors.map((vendor) => (
            <article key={vendor.id} className="rounded-2xl border border-emerald-900/10 bg-white p-4 shadow-sm">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1 space-y-3">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <h3 className="break-words text-lg font-bold text-[#2C4A3E]">{vendor.name}</h3>
                    <span className={`shrink-0 rounded-full px-2 py-1 text-xs font-bold ${vendor.enabled ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-500'}`}>{vendor.enabled ? '可使用' : '暫停使用'}</span>
                  </div>
                  <p className="whitespace-pre-wrap break-words text-sm leading-6 text-gray-600">{vendor.description || '尚未提供店家介紹。'}</p>
                  <div className="flex flex-wrap gap-2 text-xs font-bold">
                    <span className={`rounded-full px-2 py-1 ${vendor.is_open_for_ordering ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-500'}`}>{vendor.is_open_for_ordering ? '目前開團中' : '目前未開團'}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                    <span className="font-bold text-gray-500">最後點餐時間</span>
                    <span className="text-gray-700">{formatVendorCutoff(latestVendorOrderingGroup(vendor)) || '尚無開團截止時間'}</span>
                  </div>
                </div>
                <MenuSnapshot key={`${vendor.id}-${vendor.menu_image_url}`} vendor={vendor} variant="thumbnail" />
              </div>
              <button type="button" onClick={() => onSelectVendor(vendor.id)} className="mt-4 w-full rounded-xl bg-[#2C4A3E] px-4 py-2.5 text-sm font-bold text-white transition hover:bg-emerald-800">查看店家</button>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function VendorEditor({ vendor, onSaveVendor }) {
  const [form, setForm] = useState(() => formFromVendor(vendor));
  const [actionError, setActionError] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const setField = (field, value) => setForm((current) => ({ ...current, [field]: value }));

  const handleSubmit = async (event) => {
    event.preventDefault();
    const validationError = validateForm(form);
    if (validationError) {
      setActionError(validationError);
      return;
    }
    setActionError('');
    setActionLoading(true);
    try {
      await onSaveVendor(vendor.id, {
        description: form.description.trim(),
        phone: form.phone.trim(),
        address: form.address.trim(),
        website_url: form.website_url.trim(),
        menu_source_url: form.menu_source_url.trim(),
        menu_image_url: form.menu_image_url.trim(),
        menu_updated_at: form.menu_updated_at || null,
        enabled: form.enabled
      });
    } catch (error) {
      setActionError(errorMessage(error, '店家資料更新失敗，請稍後再試'));
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
      <div><h3 className="font-bold text-[#2C4A3E]">店家資料管理</h3><p className="mt-1 text-xs text-amber-800">Admin／ProxyAdmin 可編輯店家 metadata。</p></div>
      {actionError && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">{actionError}</div>}
      <label className="block space-y-1 text-xs font-bold text-gray-600" htmlFor="vendor-description">店家簡介<textarea id="vendor-description" rows="3" value={form.description} onChange={(event) => setField('description', event.target.value)} disabled={actionLoading} className={inputClass} /></label>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {[['phone', '電話'], ['address', '地址'], ['website_url', '官方網站網址'], ['menu_source_url', '官方最新菜單網址']].map(([field, label]) => (
          <label key={field} className="block space-y-1 text-xs font-bold text-gray-600" htmlFor={`vendor-${field}`}>
            {label}<input id={`vendor-${field}`} type={field.endsWith('_url') ? 'url' : 'text'} value={form[field]} onChange={(event) => setField(field, event.target.value)} disabled={actionLoading} className={inputClass} />
          </label>
        ))}
      </div>
      <label className="block space-y-1 text-xs font-bold text-gray-600" htmlFor="vendor-menu-image-url">Cloudinary 菜單快照網址<input id="vendor-menu-image-url" type="url" value={form.menu_image_url} onChange={(event) => setField('menu_image_url', event.target.value)} disabled={actionLoading} placeholder="貼上 Cloudinary 菜單快照網址" className={inputClass} /><span className="font-normal text-gray-500">第一版只儲存外部資產網址，不上傳圖片。</span></label>
      <label className="block space-y-1 text-xs font-bold text-gray-600" htmlFor="vendor-menu-updated-at">菜單最後更新日期<input id="vendor-menu-updated-at" type="date" value={form.menu_updated_at} onChange={(event) => setField('menu_updated_at', event.target.value)} disabled={actionLoading} className={inputClass} /></label>
      <label className="flex items-center gap-2 text-xs font-bold text-gray-600" htmlFor="vendor-enabled"><input id="vendor-enabled" type="checkbox" checked={form.enabled} onChange={(event) => setField('enabled', event.target.checked)} disabled={actionLoading} />店家可使用</label>
      <button type="submit" disabled={actionLoading} className="w-full rounded-xl bg-[#2C4A3E] px-4 py-2.5 text-sm font-bold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-gray-300">{actionLoading ? '儲存中...' : '儲存店家資料'}</button>
    </form>
  );
}

function MenuSnapshot({ vendor, variant = 'detail' }) {
  const [menuImageFailed, setMenuImageFailed] = useState(false);
  const [menuImageOpen, setMenuImageOpen] = useState(false);
  const imageAlt = `${vendor.name} 菜單快照`;
  const isThumbnail = variant === 'thumbnail';
  const handleMenuImageError = () => {
    setMenuImageFailed(true);
    setMenuImageOpen(false);
  };

  if (!vendor.menu_image_url && isThumbnail) return null;

  if (vendor.menu_image_url && !menuImageFailed) {
    return (
      <>
        <button
          type="button"
          aria-haspopup="dialog"
          aria-label={`放大檢視${imageAlt}`}
          onClick={() => setMenuImageOpen(true)}
          className={`block cursor-pointer rounded-xl text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 ${isThumbnail ? 'w-full max-w-[12rem] self-start sm:w-40 sm:max-w-none' : 'w-full'}`}
        >
          <img
            src={vendor.menu_image_url}
            alt={imageAlt}
            onError={handleMenuImageError}
            className={`${isThumbnail ? 'h-32 w-full' : 'max-h-[32rem] w-full'} cursor-zoom-in rounded-xl border border-gray-100 object-contain transition hover:opacity-90`}
          />
        </button>
        <Modal
          open={menuImageOpen}
          title={imageAlt}
          onClose={() => setMenuImageOpen(false)}
          ariaLabel="關閉菜單圖片預覽"
          className="max-w-5xl"
        >
          <div className="flex items-center justify-center">
            <img
              src={vendor.menu_image_url}
              alt={imageAlt}
              onError={handleMenuImageError}
              className="max-h-[calc(90vh-8rem)] max-w-[95vw] w-auto rounded-xl object-contain"
            />
          </div>
        </Modal>
      </>
    );
  }

  if (isThumbnail) {
    return <div className="w-full max-w-[12rem] rounded-xl border border-dashed border-gray-300 bg-gray-50 p-3 text-center text-xs text-gray-500">菜單快照目前無法顯示。</div>;
  }

  return <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-8 text-center text-sm text-gray-500">{menuImageFailed ? '菜單快照目前無法顯示。' : '尚未提供 Cloudinary 菜單快照。'}</div>;
}

function VendorDetail({ vendor, loading, error, canManageVendors, canManageCalendar, isViewAsMode, onBackToList, onBackToCalendar, onRetry, onSaveVendor, onOpenGroupManagement }) {
  if (!vendor) {
    return <div role={loading ? undefined : 'alert'} className={`rounded-2xl border p-4 text-sm ${loading ? 'border-emerald-100 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800'}`}>{loading ? '讀取店家資料中...' : (error || '找不到店家資料。')}{!loading && <button type="button" onClick={onBackToList} className="mt-3 block font-bold underline">返回店家專區</button>}</div>;
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><button type="button" onClick={onBackToList} className="text-sm font-bold text-emerald-800 hover:underline">← 店家專區</button><button type="button" onClick={onBackToCalendar} className="rounded-xl border border-emerald-200 px-3 py-2 text-xs font-bold text-emerald-800 transition hover:bg-emerald-50">月曆</button></div>
      {error && <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"><p>{error}</p><button type="button" onClick={onRetry} className="mt-3 font-bold underline">重新整理</button></div>}
      {loading && <p className="rounded-xl bg-emerald-50 p-3 text-xs text-emerald-800">讀取最新店家資料中...</p>}
      <section className="space-y-3 rounded-2xl border border-emerald-900/10 bg-white p-4 shadow-sm"><div className="flex items-start justify-between gap-3"><div><h2 className="text-2xl font-bold text-[#2C4A3E]">{vendor.name}</h2><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-gray-600">{vendor.description || '尚未提供店家簡介。'}</p></div><span className={`shrink-0 rounded-full px-2 py-1 text-xs font-bold ${vendor.enabled ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-500'}`}>{vendor.enabled ? '可使用' : '暫停使用'}</span></div><div className="border-t border-emerald-100 pt-3"><h3 className="font-bold text-[#2C4A3E]">店家資訊</h3><dl className="mt-2 space-y-2 text-sm text-gray-600"><div><dt className="inline font-bold">電話：</dt><dd className="inline">{vendor.phone || '尚未提供'}</dd></div><div><dt className="inline font-bold">地址：</dt><dd className="inline">{vendor.address || '尚未提供'}</dd></div><div><dt className="inline font-bold">最後點餐時間：</dt><dd className="inline">{formatVendorCutoff(latestVendorOrderingGroup(vendor)) || '尚無開團截止時間'}</dd></div>{vendor.website_url && <div><dt className="inline font-bold">官方網站：</dt><dd className="inline"><a className="text-emerald-700 underline" href={vendor.website_url} target="_blank" rel="noreferrer">查看官方網站 ↗</a></dd></div>}</dl></div></section>
      <section className="space-y-3 rounded-2xl border border-emerald-900/10 bg-white p-4 shadow-sm"><h3 className="font-bold text-[#2C4A3E]">菜單</h3><MenuSnapshot key={`${vendor.id}-${vendor.menu_image_url}`} vendor={vendor} /><p className="text-sm text-gray-600">菜單更新：{formatVendorDate(vendor.menu_updated_at) || '尚未提供'}</p>{vendor.menu_source_url ? <a href={vendor.menu_source_url} target="_blank" rel="noreferrer" className="inline-flex rounded-xl bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-800 hover:bg-emerald-100">查看最新官方菜單 ↗</a> : <p className="text-xs text-gray-400">尚未提供官方菜單網址。</p>}</section>
      <section className="space-y-3 rounded-2xl border border-emerald-900/10 bg-white p-4 shadow-sm"><h3 className="font-bold text-[#2C4A3E]">最近開團</h3>{vendor.recent_groups.length === 0 ? <p className="text-sm text-gray-500">目前沒有開團紀錄。</p> : <div className="space-y-2">{vendor.recent_groups.map((group) => <div key={`${group.order_date}-${group.mode}`} className="flex items-center justify-between gap-3 rounded-xl bg-gray-50 px-3 py-2 text-sm"><span className="font-bold text-gray-700">{formatVendorDate(group.order_date)}</span><span className={group.is_expired ? 'text-gray-400' : 'text-emerald-700'}>{group.is_expired ? '已截止' : '可訂餐'}</span></div>)}</div>}</section>
      {canManageCalendar && !isViewAsMode && <button type="button" onClick={() => onOpenGroupManagement(vendor.name)} className="w-full rounded-xl bg-amber-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-amber-700">📅 前往開團管理</button>}
      {canManageVendors && !isViewAsMode && <VendorEditor key={vendor.id} vendor={vendor} onSaveVendor={onSaveVendor} />}
    </div>
  );
}

export default function VendorHub({ vendors = [], selectedVendor = null, loading = false, detailLoading = false, error = '', detailError = '', gasUnsupported = false, canManageVendors = false, canManageCalendar = false, isViewAsMode = false, onRetry = async () => {}, onSelectVendor = async () => {}, onBackToList = () => {}, onBackToCalendar = () => {}, onSaveVendor = async () => {}, onOpenGroupManagement = () => {} }) {
  if (gasUnsupported) {
    return <section className="space-y-4 rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center"><div className="text-4xl">🏪</div><h2 className="text-xl font-bold text-[#2C4A3E]">店家專區</h2><p role="alert" className="text-sm leading-6 text-amber-900">GAS 模式尚未支援店家專區。請切換至 formal Worker transport 後再使用。</p><button type="button" onClick={onBackToCalendar} className="rounded-xl bg-[#2C4A3E] px-4 py-2.5 text-sm font-bold text-white">返回月曆</button></section>;
  }
  if (selectedVendor) {
    return <VendorDetail vendor={selectedVendor} loading={detailLoading} error={detailError} canManageVendors={canManageVendors} canManageCalendar={canManageCalendar} isViewAsMode={isViewAsMode} onBackToList={onBackToList} onBackToCalendar={onBackToCalendar} onRetry={() => onSelectVendor(selectedVendor.id)} onSaveVendor={onSaveVendor} onOpenGroupManagement={onOpenGroupManagement} />;
  }
  return <VendorList vendors={vendors.map(normalizeVendor).filter(Boolean)} loading={loading} error={error} onRetry={onRetry} onSelectVendor={onSelectVendor} onBackToCalendar={onBackToCalendar} />;
}

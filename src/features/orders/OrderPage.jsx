import { formatSignedAmount } from './amountFormat.js';

export default function OrderPage({
  selectedDate,
  previousDate,
  nextDate,
  onPreviousDate,
  onNextDate,
  setting,
  isExpired,
  policyBlocked,
  readOnly,
  isViewAsMode,
  floor,
  onFloorChange,
  orderNote,
  onOrderNoteChange,
  dailyFlavorCard,
  groupedMenu,
  imageLoadErrors,
  onImageError,
  onImagePreview,
  orderItems,
  onDecreaseItem,
  onIncreaseItem,
  message
}) {
  const controlsDisabled = isExpired || readOnly || isViewAsMode;
  const policyControlsDisabled = controlsDisabled || policyBlocked;

  return (
<div className="space-y-4">
            <div className="bg-white p-4 rounded-2xl shadow-sm border border-emerald-900/10 flex justify-between items-center gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <button
                  type="button"
                  onClick={onPreviousDate}
                  disabled={!previousDate}
                  aria-label={previousDate ? `切換到上一個開團日 ${previousDate}` : '沒有上一個開團日'}
                  title={previousDate ? `上一個開團日：${previousDate}` : '沒有上一個開團日'}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-emerald-900/10 bg-emerald-50 text-xl font-bold text-[#2C4A3E] transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-300"
                >
                  ‹
                </button>
                <div className="min-w-0">
                  <span className="text-xs text-gray-500">預訂日期</span>
                  <h2 className="text-lg font-bold text-[#2C4A3E] break-words">{selectedDate} ({setting?.vendor})</h2>
                </div>
                <button
                  type="button"
                  onClick={onNextDate}
                  disabled={!nextDate}
                  aria-label={nextDate ? `切換到下一個開團日 ${nextDate}` : '沒有下一個開團日'}
                  title={nextDate ? `下一個開團日：${nextDate}` : '沒有下一個開團日'}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-emerald-900/10 bg-emerald-50 text-xl font-bold text-[#2C4A3E] transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-300"
                >
                  ›
                </button>
              </div>
              <div className="shrink-0 text-right">
                {readOnly ? (
                  <span className="bg-slate-500 text-white text-xs px-2.5 py-1 rounded-full font-bold">
                    🧾 歷史訂單 (唯讀)
                  </span>
                ) : isExpired ? (
                  <span className="bg-slate-500 text-white text-xs px-2.5 py-1 rounded-full font-bold">
                    🔒 已截止 (唯讀)
                  </span>
                ) : (
                  <span className="bg-emerald-100 text-emerald-800 text-xs px-2.5 py-1 rounded-full font-bold">
                    🟢 訂餐中
                  </span>
                )}
              </div>
            </div>

            <div className="bg-white p-4 rounded-2xl shadow-sm border border-emerald-900/10 space-y-3">
              <h3 className="font-bold text-sm text-[#2C4A3E]">我的訂購設定</h3>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">當日領取樓層</label>
                  <select
                    value={floor}
                    onChange={(e) => onFloorChange(e.target.value)}
                    disabled={policyControlsDisabled}
                    className="w-full border rounded-xl px-3 py-2 text-sm bg-white focus:outline-emerald-600 disabled:bg-gray-100 disabled:text-gray-500 disabled:cursor-not-allowed"
                  >
                    <option value="1樓">1樓</option>
                    <option value="9樓">9樓</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1" htmlFor="order-note">備註</label>
                  <input
                    id="order-note"
                    type="text"
                    placeholder="備註 (如：不要菇)"
                    value={orderNote}
                    onChange={(e) => onOrderNoteChange(e.target.value)}
                    disabled={policyControlsDisabled}
                    className="w-full border rounded-xl px-3 py-2 text-sm focus:outline-emerald-600 disabled:bg-gray-100 disabled:text-gray-500 disabled:cursor-not-allowed"
                  />
                </div>
              </div>
            </div>

            <div className="bg-white p-4 rounded-2xl shadow-sm border border-emerald-900/10 space-y-3">
              <h3 className="font-bold text-sm text-[#2C4A3E]">今日菜單</h3>
              {groupedMenu.length === 0 && !dailyFlavorCard ? (
                <p className="text-xs text-gray-400 text-center py-4">本日無可選菜單</p>
              ) : (
                <>
                {dailyFlavorCard && (
                  <div className="flex gap-3 py-3 border-b last:border-0" data-testid="daily-flavor-card">
                    {dailyFlavorCard.imageUrl && !imageLoadErrors.dailyFlavorCard ? (
                      <button
                        type="button"
                        aria-label={`預覽${dailyFlavorCard.name}圖片`}
                        onClick={(event) => {
                          event.stopPropagation();
                          onImagePreview(dailyFlavorCard.imageUrl, dailyFlavorCard.name);
                        }}
                        className="w-20 h-20 sm:w-24 sm:h-24 shrink-0 overflow-hidden rounded-xl border border-gray-100 shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      >
                        <img
                          src={dailyFlavorCard.imageUrl}
                          alt={dailyFlavorCard.name}
                          onError={() => onImageError('dailyFlavorCard')}
                          className="h-full w-full object-cover"
                        />
                      </button>
                    ) : (
                      <div className="w-20 h-20 sm:w-24 sm:h-24 shrink-0 rounded-xl border border-gray-100 bg-gray-50 flex items-center justify-center text-xs text-gray-400 shadow-sm">
                        無圖片
                      </div>
                    )}
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="px-2 pb-1">
                        <h4 className="font-bold text-base leading-6 text-[#2C4A3E] break-words">
                          {dailyFlavorCard.name}
                        </h4>
                        {dailyFlavorCard.description && (
                          <p className="mt-1 text-xs leading-5 text-gray-500 whitespace-pre-wrap break-words">
                            {dailyFlavorCard.description}
                          </p>
                        )}
                      </div>
                      {dailyFlavorCard.items.map((item) => {
                        const qty = orderItems[item.item_id] || 0;
                        const isSelected = qty > 0;
                        const itemNote = String(item.note || '').trim();
                        const showItemNote = itemNote && itemNote !== dailyFlavorCard.description;
                        return (
                          <div
                            key={item.item_id}
                            className={`flex justify-between items-center gap-2 rounded-xl border-l-4 px-2 py-2 transition-colors ${isSelected
                              ? 'bg-emerald-50 border-l-[#2C4A3E] shadow-sm'
                              : 'border-l-transparent'
                              }`}
                          >
                            <div className="min-w-0">
                              <div className="font-bold text-sm text-gray-800 truncate">
                                {item.dailyFlavorLabel}
                              </div>
                              <div className="text-xs text-emerald-700 font-bold flex items-center gap-1 mt-1">
                                <span className="bg-emerald-50 text-emerald-800 px-1.5 py-0.5 rounded border border-emerald-200 shadow-sm">
                                  {formatSignedAmount(item.price)}
                                </span>
                                {showItemNote && <span className="text-gray-400 font-normal bg-gray-50 px-1.5 py-0.5 rounded truncate">({itemNote})</span>}
                              </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <button
                                onClick={() => onDecreaseItem(item.item_id, qty)}
                                disabled={policyControlsDisabled}
                                aria-label={`減少${item.dailyFlavorLabel}`}
                                className={`w-7 h-7 rounded-full font-bold transition-all ${policyControlsDisabled
                                  ? 'bg-gray-100 text-gray-300 cursor-not-allowed'
                                  : 'bg-gray-100 hover:bg-gray-200 text-gray-600'
                                  }`}
                              >
                                -
                              </button>
                              <span className={`w-7 h-7 flex items-center justify-center text-sm font-bold rounded-lg border ${isSelected
                                ? 'bg-[#2C4A3E] text-white border-[#2C4A3E]'
                                : 'bg-gray-100 text-gray-800 border-gray-200'
                                }`}>
                                {qty}
                              </span>
                              <button
                                onClick={() => onIncreaseItem(item.item_id, qty)}
                                disabled={policyControlsDisabled}
                                aria-label={`增加${item.dailyFlavorLabel}`}
                                className={`w-7 h-7 rounded-full font-bold text-white transition-all ${policyControlsDisabled
                                  ? 'bg-gray-200 text-gray-400'
                                  : 'bg-[#2C4A3E] hover:bg-emerald-800'
                                  }`}
                              >
                                +
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                {groupedMenu.map((group) => {
                  const sharedNotes = Array.from(new Set(
                    group.items
                      .map((item) => String(item.note || '').trim())
                      .filter(Boolean)
                  ));
                  const sharedDescription = sharedNotes.length === 1 ? sharedNotes[0] : '';
                  const hasVariants = group.items.some((item) => Boolean(item.displayVariant));

                  return (
                    <div key={group.baseName} className="flex gap-3 py-3 border-b last:border-0">
                      {group.imageUrl && !imageLoadErrors[group.baseName] ? (
                        <button
                          type="button"
                          aria-label={`預覽${group.baseName}圖片`}
                          onClick={(event) => {
                            event.stopPropagation();
                            onImagePreview(group.imageUrl, group.baseName);
                          }}
                          className="w-20 h-20 sm:w-24 sm:h-24 shrink-0 overflow-hidden rounded-xl border border-gray-100 shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        >
                          <img
                            src={group.imageUrl}
                            alt={group.baseName}
                            onError={() => onImageError(group.baseName)}
                            className="h-full w-full object-cover"
                          />
                        </button>
                      ) : (
                        <div className="w-20 h-20 sm:w-24 sm:h-24 shrink-0 rounded-xl border border-gray-100 bg-gray-50 flex items-center justify-center text-xs text-gray-400 shadow-sm">
                          無圖片
                        </div>
                      )}

                      <div className="flex-1 min-w-0 space-y-1">
                        {hasVariants && (
                          <div className="px-2 pb-1">
                            <div className="font-bold text-base leading-6 text-[#2C4A3E] break-words">
                              {group.baseName}
                            </div>
                            {sharedDescription && (
                              <p className="mt-1 text-xs leading-5 text-gray-500 whitespace-pre-wrap break-words">
                                {sharedDescription}
                              </p>
                            )}
                          </div>
                        )}

                        {group.items.map((item) => {
                          const qty = orderItems[item.item_id] || 0;
                          const isSelected = qty > 0;
                          const itemNote = String(item.note || '').trim();
                          const showItemNote = itemNote && itemNote !== sharedDescription;
                          return (
                            <div
                              key={item.item_id}
                              className={`flex justify-between items-center gap-2 rounded-xl border-l-4 px-2 py-2 transition-colors ${isSelected
                                ? 'bg-emerald-50 border-l-[#2C4A3E] shadow-sm'
                                : 'border-l-transparent'
                                }`}
                            >
                              <div className="min-w-0">
                                <div className="font-bold text-sm text-gray-800 truncate">
                                  {item.displayVariant || group.baseName}
                                </div>
                                <div className="text-xs text-emerald-700 font-bold flex items-center gap-1 mt-1">
                                  <span className="bg-emerald-50 text-emerald-800 px-1.5 py-0.5 rounded border border-emerald-200 shadow-sm">
                                    {formatSignedAmount(item.price)}
                                  </span>
                                  {showItemNote && <span className="text-gray-400 font-normal bg-gray-50 px-1.5 py-0.5 rounded truncate">({itemNote})</span>}
                                </div>
                              </div>

                              <div className="flex items-center gap-2 shrink-0">
                                <button
                                  onClick={() => onDecreaseItem(item.item_id, qty)}
                                  disabled={policyControlsDisabled}
                                  className={`w-7 h-7 rounded-full font-bold transition-all ${policyControlsDisabled
                                    ? 'bg-gray-100 text-gray-300 cursor-not-allowed'
                                    : 'bg-gray-100 hover:bg-gray-200 text-gray-600'
                                    }`}
                                >
                                  -
                                </button>
                                <span className={`w-7 h-7 flex items-center justify-center text-sm font-bold rounded-lg border ${isSelected
                                  ? 'bg-[#2C4A3E] text-white border-[#2C4A3E]'
                                  : 'bg-gray-100 text-gray-800 border-gray-200'
                                  }`}>
                                  {qty}
                                </span>
                                <button
                                  onClick={() => onIncreaseItem(item.item_id, qty)}
                                  disabled={policyControlsDisabled}
                                  className={`w-7 h-7 rounded-full font-bold text-white transition-all ${policyControlsDisabled
                                    ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                                    : 'bg-[#2C4A3E] hover:bg-emerald-800'
                                    }`}
                                >
                                  +
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
                </>
              )}
            </div>

            {isExpired && (
              <div className="text-center text-xs font-bold p-3 rounded-xl bg-slate-100 text-slate-700 border border-slate-300">
                🔒 訂餐已截止或暫停服務
              </div>
            )}

            {policyBlocked && !isExpired && !readOnly && !isViewAsMode && (
              <div className="text-center text-xs font-bold p-3 rounded-xl bg-sky-50 text-sky-800 border border-sky-200">
                🔒 ProxyAdmin 代點餐僅限 Asia/Taipei 今日
              </div>
            )}

            {readOnly && (
              <div className="text-center text-xs font-bold p-3 rounded-xl bg-slate-100 text-slate-700 border border-slate-300">
                🧾 歷史訂單僅供檢視，無法修改或取消
              </div>
            )}

            {message && (
              <div className="text-center text-sm font-bold p-2 rounded-lg bg-emerald-50 text-emerald-800">
                {message}
              </div>
            )}
          </div>
  );
}

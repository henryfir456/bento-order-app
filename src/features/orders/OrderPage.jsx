export default function OrderPage({
  selectedDate,
  setting,
  isExpired,
  isViewAsMode,
  floor,
  onFloorChange,
  orderNote,
  onOrderNoteChange,
  groupedMenu,
  imageLoadErrors,
  onImageError,
  orderItems,
  onDecreaseItem,
  onIncreaseItem,
  message
}) {
  return (
<div className="space-y-4">
            <div className="bg-white p-4 rounded-2xl shadow-sm border border-emerald-900/10 flex justify-between items-center">
              <div>
                <span className="text-xs text-gray-500">預訂日期</span>
                <h2 className="text-lg font-bold text-[#2C4A3E]">{selectedDate} ({setting?.vendor})</h2>
              </div>
              <div className="text-right">
                {isExpired ? (
                  <span className="bg-amber-100 text-amber-800 text-xs px-2.5 py-1 rounded-full font-bold">
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
                    disabled={isExpired || isViewAsMode}
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
                    disabled={isExpired || isViewAsMode}
                    className="w-full border rounded-xl px-3 py-2 text-sm focus:outline-emerald-600 disabled:bg-gray-100 disabled:text-gray-500 disabled:cursor-not-allowed"
                  />
                </div>
              </div>
            </div>

            <div className="bg-white p-4 rounded-2xl shadow-sm border border-emerald-900/10 space-y-3">
              <h3 className="font-bold text-sm text-[#2C4A3E]">今日菜單</h3>
              {groupedMenu.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-4">本日無可選菜單</p>
              ) : (
                groupedMenu.map((group) => (
                  <div key={group.baseName} className="flex gap-3 py-3 border-b last:border-0">
                    {group.imageUrl && !imageLoadErrors[group.baseName] ? (
                      <img
                        src={group.imageUrl}
                        alt={group.baseName}
                        onError={() => onImageError(group.baseName)}
                        className="w-14 h-14 object-cover rounded-xl shadow-sm border border-gray-100 shrink-0"
                      />
                    ) : (
                      <div className="w-14 h-14 bg-gray-50 rounded-xl flex items-center justify-center border border-gray-100 text-gray-400 text-xs shadow-sm shrink-0">
                        無圖片
                      </div>
                    )}

                    <div className="flex-1 min-w-0 space-y-1">
                      {group.items.map((item) => {
                        const qty = orderItems[item.item_id] || 0;
                        const isSelected = qty > 0;
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
                                  ${item.price}
                                </span>
                                {item.note && <span className="text-gray-400 font-normal bg-gray-50 px-1.5 py-0.5 rounded truncate">({item.note})</span>}
                              </div>
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                              <button
                                onClick={() => onDecreaseItem(item.item_id, qty)}
                                disabled={isExpired || isViewAsMode}
                                className={`w-7 h-7 rounded-full font-bold transition-all ${isExpired || isViewAsMode
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
                                disabled={isExpired || isViewAsMode}
                                className={`w-7 h-7 rounded-full font-bold text-white transition-all ${isExpired || isViewAsMode
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
                ))
              )}
            </div>

            {isExpired && (
              <div className="text-center text-xs font-bold p-3 rounded-xl bg-amber-50 text-amber-800 border border-amber-200">
                🔒 訂餐已截止或暫停服務
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


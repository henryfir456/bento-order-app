export default function AdminOrderSummary({
  selectedOrderDate,
  onDateChange,
  adminSummary,
  adminSummaryLoading,
  adminSummaryError,
  aggregatedOrders
}) {
  return (
<>
                <div className="bg-white p-4 rounded-2xl shadow-sm border border-emerald-900/10 space-y-3">
                  <div className="flex flex-wrap justify-between items-center gap-3">
                    <h3 className="font-bold text-base text-[#2C4A3E]">📋 訂單管理</h3>
                    <label className="flex items-center gap-2 text-xs font-bold text-gray-600" htmlFor="admin-order-date">
                      訂單日期
                      <input
                        id="admin-order-date"
                        type="date"
                        value={selectedOrderDate}
                        onChange={(e) => onDateChange(e.target.value)}
                        className="min-w-0 border border-gray-200 rounded-xl px-2.5 py-2 bg-white text-sm focus:outline-emerald-600"
                      />
                    </label>
                  </div>
                  {adminSummary.targetDate && (
                    <p className="text-xs text-gray-500">目前顯示：{adminSummary.targetDate}</p>
                  )}
                </div>

                {adminSummaryLoading ? (
                  <div className="bg-white p-6 rounded-2xl shadow-sm border border-emerald-900/10 text-center text-sm text-emerald-800 animate-pulse">
                    讀取指定日期總覽中...
                  </div>
                ) : adminSummaryError ? (
                  <div className="bg-rose-50 p-4 rounded-2xl border border-rose-200 text-center text-sm text-rose-800">
                    {adminSummaryError}
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="bg-white p-3 rounded-2xl shadow-sm border border-emerald-900/10">
                        <div className="text-xs text-gray-500">總份數</div>
                        <div className="text-xl font-bold text-[#2C4A3E]">{adminSummary.totalItems}</div>
                      </div>
                      <div className="bg-white p-3 rounded-2xl shadow-sm border border-emerald-900/10">
                        <div className="text-xs text-gray-500">總金額</div>
                        <div className="text-xl font-bold text-[#2C4A3E]">${adminSummary.totalAmount}</div>
                      </div>
                    </div>

                    <div className="bg-white p-4 rounded-2xl shadow-sm border border-emerald-900/10 space-y-3">
                      <h3 className="font-bold text-base text-[#2C4A3E]">📦 便購種類匯總</h3>
                      {Object.keys(aggregatedOrders).length === 0 ? (
                        <p className="text-xs text-gray-400 text-center py-4">此日期目前沒有訂單</p>
                      ) : (
                        <div className="grid grid-cols-2 gap-2">
                          {Object.entries(aggregatedOrders).map(([itemKey, qty], idx) => (
                            <div key={idx} className="bg-emerald-50/60 border border-emerald-100 p-2.5 rounded-xl flex justify-between items-center">
                              <span className="text-xs font-bold text-emerald-900">{itemKey}</span>
                              <span className="text-xs font-extrabold text-emerald-700 bg-white px-2 py-0.5 rounded-md border border-emerald-200 shadow-sm">
                                x {qty}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="bg-white p-4 rounded-2xl shadow-sm border border-emerald-900/10 space-y-3">
                      <h3 className="font-bold text-base text-[#2C4A3E]">🍱 {selectedOrderDate} 訂單明細 (依樓層分組)</h3>
                      {adminSummary.todayOrders.length === 0 ? (
                        <p className="text-xs text-gray-400 text-center py-4">此日期目前沒有訂單</p>
                      ) : (
                        <div className="space-y-4">
                          {Object.entries(
                            adminSummary.todayOrders.reduce((acc, order) => {
                              const floor = order.pickup_floor || '其他';
                              if (!acc[floor]) acc[floor] = [];
                              acc[floor].push(order);
                              return acc;
                            }, {})
                          ).map(([floor, orders]) => (
                            <div key={floor} className="space-y-2">
                              <h4 className="text-sm font-bold text-emerald-800 border-b border-emerald-100 pb-1">{floor} 訂單</h4>
                              {orders.map((o, idx) => (
                                <div key={idx} className="flex justify-between items-center text-xs p-3 border border-gray-100 bg-gray-50/80 rounded-xl hover:bg-emerald-50/50 transition-colors">
                                  <div>
                                    <div className="font-bold text-gray-800">
                                      {o.name}
                                      {o.note && <span className="ml-2 text-amber-800 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200 font-normal shadow-sm">📝 {o.note}</span>}
                                    </div>
                                    <div className="text-gray-600 mt-1">
                                      {o.item_name} <span className="bg-gray-200 px-1.5 py-0.5 rounded font-bold text-gray-700">x {o.quantity}</span>
                                    </div>
                                  </div>
                                  <span className="font-bold bg-emerald-100 text-emerald-800 px-2 py-1 rounded-lg text-xs border border-emerald-200 shadow-sm">
                                    ${o.subtotal}
                                  </span>
                                </div>
                              ))}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </>
  );
}


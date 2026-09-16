import { formatSignedAmount } from '../orders/amountFormat.js';
import { shiftDateInput } from '../../dateUtils';
import { groupOrdersByFloor } from './orderSummary.js';

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
                    <div className="flex min-w-0 items-center gap-1 rounded-2xl border border-gray-200 bg-white p-1 shadow-sm">
                      <button
                        type="button"
                        aria-label="前一天"
                        title="前一天"
                        onClick={() => onDateChange(shiftDateInput(selectedOrderDate, -1))}
                        className="inline-flex min-h-[2.75rem] min-w-[2.75rem] items-center justify-center rounded-xl text-lg font-bold text-emerald-800 transition hover:bg-emerald-50 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      >
                        ◀
                      </button>
                      <label className="flex min-w-0 items-center" htmlFor="admin-order-date">
                        <span className="sr-only">訂單日期</span>
                      <input
                        id="admin-order-date"
                        aria-label="訂單日期"
                        type="date"
                        value={selectedOrderDate}
                        onChange={(e) => onDateChange(e.target.value)}
                        className="min-w-0 rounded-xl border-0 bg-transparent px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      />
                      </label>
                      <button
                        type="button"
                        aria-label="後一天"
                        title="後一天"
                        onClick={() => onDateChange(shiftDateInput(selectedOrderDate, 1))}
                        className="inline-flex min-h-[2.75rem] min-w-[2.75rem] items-center justify-center rounded-xl text-lg font-bold text-emerald-800 transition hover:bg-emerald-50 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      >
                        ▶
                      </button>
                    </div>
                  </div>
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
                        <div className="text-xl font-bold text-[#2C4A3E]">{formatSignedAmount(adminSummary.totalAmount)}</div>
                      </div>
                    </div>

                    <div className="bg-white p-4 rounded-2xl shadow-sm border border-emerald-900/10 space-y-3">
                      <h3 className="font-bold text-base text-[#2C4A3E]">📦 便購種類匯總</h3>
                      {aggregatedOrders.length === 0 ? (
                        <p className="text-xs text-gray-400 text-center py-4">此日期目前沒有訂單</p>
                      ) : (
                        <div className="space-y-4">
                          {aggregatedOrders.map(({ floor, items }) => (
                            <section key={floor} className="space-y-2">
                              <h4 className="border-b border-emerald-100 pb-1 text-sm font-bold text-emerald-800">{floor} 訂單</h4>
                              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                {items.map(({ itemName, quantity }) => (
                                  <div key={`${floor}-${itemName}`} className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-emerald-100 bg-emerald-50/60 p-2.5">
                                    <span className="min-w-0 break-words text-xs font-bold text-emerald-900">{itemName}</span>
                                    <span className="shrink-0 rounded-md border border-emerald-200 bg-white px-2 py-0.5 text-xs font-extrabold text-emerald-700 shadow-sm">
                                      × {quantity}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </section>
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
                          {groupOrdersByFloor(adminSummary.todayOrders).map(({ floor, orders }) => (
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
                                    {formatSignedAmount(o.subtotal)}
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

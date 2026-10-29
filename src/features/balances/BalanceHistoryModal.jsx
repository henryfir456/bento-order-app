import React from 'react';
import { formatDateTime } from '../../dateUtils';
import { formatSignedAmount, formatBalanceAmount } from './formatters';
import { formatLedgerOrderDate } from './ledgerFormatters';
import { formatTransactionDescription } from './topupMethods';

// Personal top-up / transaction history dialog with a month switcher and collapsible monthly summary.
export default function BalanceHistoryModal({
  selectedYear,
  selectedMonth,
  historyList,
  historySummary,
  historyLoading,
  historyError,
  historySummaryExpanded,
  setHistorySummaryExpanded,
  shiftHistoryMonth,
  onClose
}) {
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 transition-opacity">
      <div className="bg-white rounded-3xl max-w-md w-full p-6 space-y-5 shadow-2xl transform transition-all max-h-[85vh] flex flex-col border border-emerald-100">
        <div className="flex justify-between items-center border-b border-gray-100 pb-3">
          <h3 className="font-bold text-base text-[#2C4A3E] flex items-center gap-2">
            <span className="text-xl">💳</span> 個人儲值/交易明細
          </h3>
          <button
            onClick={() => onClose()}
            className="text-gray-400 hover:text-rose-500 text-lg font-bold bg-gray-50 hover:bg-rose-50 rounded-full w-8 h-8 flex items-center justify-center transition-colors"
          >
            ✕
          </button>
        </div>

        <div className="flex items-center justify-between gap-2 rounded-2xl bg-emerald-50 px-2 py-2">
          <button
            type="button"
            aria-label="上一個月"
            onClick={() => shiftHistoryMonth(-1)}
            disabled={historyLoading}
            className="min-w-10 min-h-10 rounded-xl bg-white text-[#2C4A3E] font-bold shadow-sm disabled:text-gray-300"
          >
            ◀
          </button>
          <span className="text-sm font-bold text-[#2C4A3E]" aria-live="polite">
            {selectedYear} 年 {selectedMonth} 月
          </span>
          <button
            type="button"
            aria-label="下一個月"
            onClick={() => shiftHistoryMonth(1)}
            disabled={historyLoading}
            className="min-w-10 min-h-10 rounded-xl bg-white text-[#2C4A3E] font-bold shadow-sm disabled:text-gray-300"
          >
            ▶
          </button>
        </div>

        {!historyLoading && !historyError && (
          <div className="space-y-2">
            <button
              type="button"
              aria-expanded={historySummaryExpanded}
              aria-controls="monthly-balance-summary"
              onClick={() => setHistorySummaryExpanded((expanded) => !expanded)}
              className="flex w-full items-center justify-between gap-3 rounded-2xl border border-emerald-100 bg-emerald-50 px-3 py-2.5 text-left text-xs"
            >
              <span className="min-w-0">
                <span className="block font-bold text-[#2C4A3E]">本月摘要</span>
                <span className="mt-1 block truncate text-gray-600">
                  月初 {formatBalanceAmount(historySummary.openingBalance)} → 月底 {formatBalanceAmount(historySummary.closingBalance)}
                </span>
              </span>
              <span className="shrink-0 text-right font-bold">
                <span className="block text-emerald-800">+${historySummary.totalCredit}</span>
                <span className="block text-rose-800">-${historySummary.totalDebit}</span>
                <span className="mt-1 block text-[11px] text-[#2C4A3E]">{historySummaryExpanded ? '收合' : '展開'} {historySummaryExpanded ? '⌃' : '⌄'}</span>
              </span>
            </button>
            {historySummaryExpanded && (
              <div id="monthly-balance-summary" className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-xl bg-gray-50 border border-gray-100 p-2.5">
                  <div className="text-gray-500">月初餘額</div>
                  <div className="font-bold text-gray-800 mt-1">{formatBalanceAmount(historySummary.openingBalance)}</div>
                </div>
                <div className="rounded-xl bg-gray-50 border border-gray-100 p-2.5">
                  <div className="text-gray-500">月底餘額</div>
                  <div className="font-bold text-gray-800 mt-1">{formatBalanceAmount(historySummary.closingBalance)}</div>
                </div>
                <div className="rounded-xl bg-emerald-50 border border-emerald-100 p-2.5">
                  <div className="text-emerald-700">本月增加</div>
                  <div className="font-bold text-emerald-800 mt-1">+${historySummary.totalCredit}</div>
                </div>
                <div className="rounded-xl bg-rose-50 border border-rose-100 p-2.5">
                  <div className="text-rose-700">本月扣除</div>
                  <div className="font-bold text-rose-800 mt-1">-${historySummary.totalDebit}</div>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="flex-1 overflow-y-auto space-y-3 pr-2 custom-scrollbar">
          {historyLoading ? (
            <p className="text-center text-xs text-gray-400 py-6 animate-pulse">交易明細載入中…</p>
          ) : historyError ? (
            <p className="text-center text-xs text-rose-700 bg-rose-50 border border-rose-100 rounded-xl p-4">{historyError}</p>
          ) : historyList.length === 0 ? (
            <p className="text-center text-xs text-gray-400 py-6">此月份尚無交易紀錄</p>
          ) : (
            historyList.map((item, idx) => (
              <div key={idx} className="bg-gray-50/80 p-3.5 rounded-2xl flex justify-between items-center text-xs border border-gray-100 shadow-sm hover:shadow-md transition-shadow">
                <div>
                  <div className="font-bold text-gray-700 text-sm mb-1">{formatTransactionDescription(item)}</div>
                  {item.order && (
                    <div className="space-y-0.5 text-[11px] text-gray-600">
                      <div>{formatLedgerOrderDate(item.order.orderDate)} {item.order.vendorName}</div>
                      {item.order.items.map((orderItem, itemIndex) => (
                        <div key={`${orderItem.name}-${itemIndex}`}>
                          {orderItem.name} × {orderItem.quantity}
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="text-[10px] text-gray-400">{formatDateTime(item.occurredAt || item.timestamp)}</div>
                </div>
                <div className="text-right">
                  <div className={`font-bold text-xs px-2 py-1 rounded-lg inline-block ${(item.amount ?? item.changeAmount) >= 0 ? 'bg-emerald-100 text-emerald-700 border border-emerald-200' : 'bg-rose-100 text-rose-600 border border-rose-200'}`}>
                    {formatSignedAmount(item.amount ?? item.changeAmount)}
                  </div>
                  <div className="text-[10px] text-gray-500 mt-1.5 font-medium">結餘: {formatBalanceAmount(item.balanceAfter ?? item.balance)}</div>
                </div>
              </div>
            ))
          )}
        </div>

        <button
          onClick={() => onClose()}
          className="w-full bg-[#2C4A3E] text-white py-3 rounded-2xl text-sm font-bold hover:bg-emerald-800 transition shadow-md active:scale-95"
        >
          關閉
        </button>
      </div>
    </div>
  );
}

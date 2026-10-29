import React from 'react';
import { formatDateInput, getWeekdayLeadingBlankCount } from '../../dateUtils';
import { getCalendarDailyFlavorImage } from '../orders/dailyFlavorPresentation.js';
import { normalizeVendorName } from '../vendors/vendorModel';

// Pure rendering helpers for the classic and rolling calendar grids. State and handlers come from App via `ctx`.

// 精確比對 Intl 回傳的農曆日期（只標示初一與十五）
export const getLunarLabel = (dateStr) => {
  if (!dateStr) return '';
  try {
    const [year, month, day] = dateStr.split('-').map(Number);
    const date = new Date(year, month - 1, day);

    // 取得農曆日期的格式化字串
    const formatter = new Intl.DateTimeFormat('zh-TW-u-ca-chinese', {
      day: 'numeric'
    });
    const lunarText = formatter.format(date); // 可能會是 "1", "1日", "初一", "15", "15日", "十五" 等

    // 使用正規表示式或包含比對
    if (lunarText.includes('初一') || lunarText === '1' || lunarText === '1日') {
      return '初一';
    }
    if (lunarText.includes('十五') || lunarText === '15' || lunarText === '15日') {
      return '十五';
    }
    return '';
  } catch (e) {
    return '';
  }
};

export const renderCalendarDays = ({
  currentMonth,
  calendarEvents,
  userOrdersMap,
  calendarFlavorImageErrors,
  setCalendarFlavorImageErrors,
  likesLoaded,
  likeMutationInFlight,
  isViewAsMode,
  handleSelectDate,
  handleToggleLike,
  handleImagePreview
}, dateList = null) => {
  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const firstWeekdayColumn = getWeekdayLeadingBlankCount(year, month);
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const days = [];
  if (!dateList) {
    for (let i = 0; i < firstWeekdayColumn; i++) {
      days.push(<div key={`empty-${i}`} className="h-24 bg-gray-50/50 border border-gray-100 rounded-lg"></div>);
    }
  }
  const targets = dateList || Array.from({ length: daysInMonth }, (_, i) => (
    `${year}-${String(month + 1).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`
  ));

  for (const dateStr of targets) {
    const day = Number(dateStr.slice(8));
    const date = new Date(`${dateStr}T12:00:00`);
    const dayOfWeek = date.getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) continue;

    const event = calendarEvents[dateStr];
    const eventExpired = Boolean(event?.isExpired || event?.expired);
    const isUserOrdered = Boolean(userOrdersMap[dateStr]);
    const hasVendor = Boolean(event?.vendor);
    const showDailyFlavorName = Boolean(
      event?.dailyFlavorName
      && (!hasVendor || normalizeVendorName(event.vendor) === '蔡老師')
    );
    const dailyFlavorImageUrl = getCalendarDailyFlavorImage(event, dateStr);
    const showDailyFlavorImage = Boolean(
      showDailyFlavorName
      && dailyFlavorImageUrl
      && !calendarFlavorImageErrors[`${dateStr}:${dailyFlavorImageUrl}`]
    );

    let statusBg = "bg-white text-gray-400 border-gray-200";
    let statusBadge = null;

    if (hasVendor) {
      if (isUserOrdered) {
        if (eventExpired) {
          statusBg = "bg-slate-100 border-slate-300 text-slate-800 hover:bg-slate-200 cursor-pointer";
          statusBadge = <span className="text-[9px] bg-slate-500 text-white px-1 py-0.5 rounded font-medium">已訂</span>;
        } else {
          statusBg = "bg-blue-50 border-blue-300 text-blue-900 hover:bg-blue-100 cursor-pointer shadow-sm";
          statusBadge = <span className="text-[9px] bg-blue-600 text-white px-1 py-0.5 rounded font-medium">已訂</span>;
        }
      } else {
        if (eventExpired) {
          statusBg = "bg-slate-100 border-slate-300 text-slate-700 hover:bg-slate-200 cursor-pointer";
          statusBadge = <span className="text-[9px] bg-slate-300 border border-slate-400 text-slate-700 px-1 py-0.5 rounded font-medium">截止</span>;
        } else {
          statusBg = "bg-emerald-50 border-emerald-300 text-emerald-900 hover:bg-emerald-100 cursor-pointer shadow-sm";
          statusBadge = <span className="text-[9px] bg-emerald-600 text-white px-1 py-0.5 rounded font-medium">可訂</span>;
        }
      }
    } else {
      // 未開團模式
      statusBg = "bg-gray-50/70 text-gray-400 border-dashed border-gray-200 hover:bg-gray-100 cursor-pointer";
    }

    // 1. 在 days.push 前，先根據當天的 dateStr 計算出農曆標籤
    const lunarLabel = getLunarLabel(dateStr);
    const isTodayCell = Boolean(dateList) && dateStr === formatDateInput(new Date());

    days.push(
      <div
        key={dateStr}
        onClick={() => handleSelectDate(dateStr)}
        className={`min-h-[132px] min-w-0 p-1.5 border rounded-xl flex flex-col justify-between transition-all relative ${statusBg}${isTodayCell ? ' ring-2 ring-amber-500 ring-offset-1' : ''}`}
      >
        <div className="flex justify-between items-start">
          <span className="flex items-center gap-1 font-bold text-sm leading-none">{day}{isTodayCell && <span className="rounded bg-amber-500 px-1 py-0.5 text-[9px] font-bold text-white">今天</span>}</span>

          {/* 2. 改用計算出來的 lunarLabel，這樣每一天都能正確顯示初一/十五 */}
          {lunarLabel && (
            <span className="text-[9px] bg-rose-100 text-rose-700 font-bold px-1 rounded border border-rose-200">
              {lunarLabel === '初一' ? '初一' : lunarLabel === '十五' ? '十五' : lunarLabel}
            </span>
          )}
        </div>

        <div className="my-auto min-w-0">
          {hasVendor ? (
            <div className="flex min-w-0 items-center justify-between gap-1">
              <span className="min-w-0 truncate text-xs font-bold text-gray-700">
                {event.vendor}
              </span>
              <span
                className="shrink-0 whitespace-nowrap text-[11px] font-medium text-gray-500"
                aria-label={`便當總數 ${event.totalQuantity ?? 0}`}
              >
                🍱{event.totalQuantity ?? 0}
              </span>
            </div>
          ) : (
            <div className="text-[10px] text-gray-400 font-normal">未開團</div>
          )}
          {showDailyFlavorName && (
            <div
              className="mt-0.5 truncate text-[9px] font-medium text-amber-700"
              title={event.dailyFlavorName}
            >
              {event.dailyFlavorName}
            </div>
          )}
          {showDailyFlavorImage && (
            <button
              type="button"
              aria-label={`放大檢視${event.dailyFlavorName}圖片`}
              onClick={(clickEvent) => {
                clickEvent.stopPropagation();
                handleImagePreview(dailyFlavorImageUrl, event.dailyFlavorName);
              }}
              className="mt-1 block w-full min-w-0 overflow-hidden rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              <img
                src={dailyFlavorImageUrl}
                alt={`${event.dailyFlavorName}餐點`}
                loading="lazy"
                decoding="async"
                onError={() => setCalendarFlavorImageErrors((current) => ({
                  ...current,
                  [`${dateStr}:${dailyFlavorImageUrl}`]: true
                }))}
                className="h-11 w-full rounded-md object-cover"
              />
            </button>
          )}
        </div>

        <div className="flex min-w-0 flex-wrap justify-between items-end gap-x-1 gap-y-0.5 mt-1">
          {/* 愛心投票按鈕 */}
          {likesLoaded ? (
            <button
              onClick={(e) => handleToggleLike(e, dateStr)}
              disabled={isViewAsMode || likeMutationInFlight}
              className="flex items-center gap-0.5 text-xs focus:outline-none hover:scale-110 transition-transform disabled:cursor-not-allowed disabled:opacity-50"
              title="點愛心開蔡老師團"
            >
              <span>{event?.isUserLiked ? '❤️' : '🤍'}</span>
              <span className={`text-[10px] font-bold ${event?.likeCount > 0 ? 'text-rose-600' : 'text-gray-400'}`}>
                {event?.likeCount || 0}
              </span>
            </button>
          ) : (
            <span
              aria-label="Like status loading"
              className="flex h-4 w-8 items-center justify-center text-xs text-gray-300"
            >
              …
            </span>
          )}

          {statusBadge}
        </div>
      </div>
    );
  }
  return days;
};

export const renderWeekendEvents = ({ currentMonth, calendarEvents, handleSelectDate }) => {
  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const weekdayLabels = ['日', '一', '二', '三', '四', '五', '六'];

  return Object.entries(calendarEvents)
    .filter(([dateStr, event]) => {
      if (!event?.vendor) return false;
      const date = new Date(`${dateStr}T00:00:00`);
      const dayOfWeek = date.getDay();
      return !Number.isNaN(date.getTime())
        && date.getFullYear() === year
        && date.getMonth() === month
        && (dayOfWeek === 0 || dayOfWeek === 6);
    })
    .sort(([dateA], [dateB]) => dateA.localeCompare(dateB))
    .map(([dateStr, event]) => {
      const date = new Date(`${dateStr}T00:00:00`);
      const eventExpired = Boolean(event?.isExpired || event?.expired);

      const eventClassName = eventExpired
        ? 'w-full text-left bg-slate-100 border border-slate-300 hover:bg-slate-200 rounded-xl p-3 transition-colors'
        : 'w-full text-left bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 rounded-xl p-3 transition-colors';
      const eventDateClassName = eventExpired
        ? 'font-bold text-sm text-slate-800'
        : 'font-bold text-sm text-emerald-900';

      return (
        <button
          key={dateStr}
          type="button"
          onClick={() => handleSelectDate(dateStr)}
          className={eventClassName}
        >
          <div className="flex justify-between items-center gap-3">
            <span className={eventDateClassName}>
              {date.getMonth() + 1}/{date.getDate()}（{weekdayLabels[date.getDay()]}）
            </span>
            <div className="flex items-center gap-2 text-xs">
              {event.likeCount > 0 && <span className="text-rose-600 font-bold">❤️ {event.likeCount}</span>}
              <span className={eventExpired ? 'bg-slate-500 text-white px-2 py-1 rounded-lg font-bold' : 'bg-emerald-600 text-white px-2 py-1 rounded-lg font-bold'}>
                {eventExpired ? '截止' : '可訂'}
              </span>
            </div>
          </div>
          <div className="text-xs text-gray-700 font-bold mt-1">{event.vendor}</div>
        </button>
      );
    });
};

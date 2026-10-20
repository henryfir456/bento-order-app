export default function AnnouncementBell({ unreadCount = 0, onClick }) {
  const count = Math.max(0, Number(unreadCount) || 0);
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={count ? `公告通知，${count} 則未讀` : '公告通知'}
      aria-haspopup="dialog"
      className="relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-emerald-100 transition hover:bg-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-200"
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path strokeLinecap="round" strokeLinejoin="round" d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
      </svg>
      {count > 0 && (
        <span
          aria-hidden="true"
          className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-rose-500 px-1 text-center text-[10px] font-bold leading-4 text-white"
        >
          {count > 99 ? '99+' : count}
        </span>
      )}
    </button>
  );
}

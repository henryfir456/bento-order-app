export default function AnnouncementBar({ announcement, onClick }) {
  if (!announcement) return null;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`查看公告：${announcement.title}`}
      className="mb-4 flex w-full min-w-0 items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-left text-sm text-amber-900 shadow-sm transition hover:bg-amber-100 focus:outline-none focus:ring-2 focus:ring-amber-400"
    >
      <span aria-hidden="true" className="shrink-0">📢</span>
      <span className="min-w-0 flex-1 truncate font-bold">{announcement.title}</span>
      <span aria-hidden="true" className="shrink-0 text-lg leading-none">›</span>
    </button>
  );
}

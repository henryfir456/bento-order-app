const formatAnnouncementDate = (date) => String(date || '').replace(/-/g, '/');

export default function AnnouncementContent({ announcement }) {
  if (!announcement) return null;
  return (
    <article className="space-y-3">
      <h3 className="break-words font-bold text-[#2C4A3E]">{announcement.title}</h3>
      <time dateTime={announcement.start_date} className="block text-xs text-gray-400">
        公告日期：{formatAnnouncementDate(announcement.start_date)}
      </time>
      <p className="whitespace-pre-wrap break-words text-sm leading-7 text-gray-600">{announcement.content}</p>
      {Array.isArray(announcement.images) && announcement.images.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {announcement.images.map((imageUrl, index) => (
            <a key={imageUrl} href={imageUrl} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-2xl border border-gray-100 bg-gray-50">
              <img
                src={imageUrl}
                alt={`${announcement.title} 圖片 ${index + 1}`}
                className="max-h-[70vh] w-full object-contain"
                loading="lazy"
              />
            </a>
          ))}
        </div>
      )}
    </article>
  );
}

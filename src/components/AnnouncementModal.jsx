import Modal from './Modal';

const formatAnnouncementDate = (date) => String(date || '').replace(/-/g, '/');

export default function AnnouncementModal({ open, announcements = [], loading = false, onClose }) {
  if (!open || (!loading && announcements.length === 0)) return null;

  return (
    <Modal
      open={open}
      title="公告詳情"
      onClose={onClose}
      className="max-w-lg"
    >
      <div className="space-y-5">
        {loading ? (
          <div role="status" className="text-sm text-gray-500">Announcement loading…</div>
        ) : announcements.map((announcement) => (
          <article key={announcement.id} className="space-y-2">
            <h3 className="font-bold text-[#2C4A3E]">{announcement.title}</h3>
            <time dateTime={announcement.start_date} className="block text-xs text-gray-400">
              📅 公告日期：{formatAnnouncementDate(announcement.start_date)}
            </time>
            <p className="whitespace-pre-wrap text-sm leading-7 text-gray-600">{announcement.content}</p>
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
        ))}
      </div>
    </Modal>
  );
}

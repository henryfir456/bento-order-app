import Modal from './Modal';

export default function AnnouncementModal({ open, announcements = [], onClose }) {
  if (announcements.length === 0) return null;

  return (
    <Modal
      open={open}
      title="公告詳情"
      onClose={onClose}
      className="max-w-lg"
    >
      <div className="space-y-5">
        {announcements.map((announcement) => (
          <article key={announcement.id} className="space-y-2">
            <h3 className="font-bold text-[#2C4A3E]">{announcement.title}</h3>
            <p className="whitespace-pre-wrap text-sm leading-7 text-gray-600">{announcement.content}</p>
          </article>
        ))}
      </div>
    </Modal>
  );
}

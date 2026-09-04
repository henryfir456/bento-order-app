import Modal from './Modal';

export default function AnnouncementModal({ open, announcement, onClose }) {
  if (!announcement) return null;

  return (
    <Modal
      open={open}
      title={announcement?.title}
      onClose={onClose}
      className="max-w-lg"
    >
      <p className="whitespace-pre-wrap text-sm leading-7 text-gray-600">{announcement?.content}</p>
    </Modal>
  );
}

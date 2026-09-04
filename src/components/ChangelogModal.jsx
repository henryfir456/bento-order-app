import Modal from './Modal';

export default function ChangelogModal({ open, onClose, version, changelog }) {
  return (
    <Modal
      open={open}
      title={`開發歷程 v${version}`}
      onClose={onClose}
      className="max-w-lg"
    >
      <div className="space-y-5">
        {changelog.map((release) => (
          <section key={release.version} className="space-y-2">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="font-bold text-[#2C4A3E]">v{release.version}</h3>
              <time className="text-xs text-gray-400" dateTime={release.date}>{release.date}</time>
            </div>
            <ul className="list-disc space-y-1 pl-5 text-sm text-gray-600">
              {release.changes.map((change) => <li key={change}>{change}</li>)}
            </ul>
          </section>
        ))}
      </div>
    </Modal>
  );
}

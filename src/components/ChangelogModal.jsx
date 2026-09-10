import Modal from './Modal';

export default function ChangelogModal({ open, onClose, version, changelog }) {
  const formalReleases = (changelog || []).filter((release) => (
    typeof release?.version === 'string' && /^\d+\.\d+\.\d+$/.test(release.version)
  ));

  return (
    <Modal
      open={open}
      title={`開發歷程 v${version}`}
      onClose={onClose}
      className="max-w-lg"
    >
      <div className="space-y-5">
        {formalReleases.map((release) => {
          const releaseLabel = `v${release.version}`;
          const categories = release.categories?.length
            ? release.categories
            : [{ name: 'Changes', changes: release.changes || [] }];

          return (
            <section key={release.version} className="space-y-2">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="font-bold text-[#2C4A3E]">{releaseLabel}</h3>
                {release.date && <time className="text-xs text-gray-400" dateTime={release.date}>{release.date}</time>}
              </div>
              {categories.map((category, categoryIndex) => (
                <div key={`${category.name}-${categoryIndex}`} className="space-y-1">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">{category.name}</h4>
                  <ul className="list-disc space-y-1 pl-5 text-sm text-gray-600">
                    {category.changes.map((change, changeIndex) => <li key={`${categoryIndex}-${changeIndex}`}>{change}</li>)}
                  </ul>
                </div>
              ))}
            </section>
          );
        })}
      </div>
    </Modal>
  );
}

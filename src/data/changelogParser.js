const RELEASE_HEADING = /^##\s+\[([^\]]+)\](?:\s+-\s+(\d{4}-\d{2}-\d{2}))?\s*$/;
const CATEGORY_HEADING = /^###\s+(.+?)\s*$/;
const CHANGE_ITEM = /^-\s+(.+)$/;
const COMMITS_LINE = /^\*\*Commits:\*\*\s*(.*)$/i;
const FORMAL_VERSION = /^\d+\.\d+\.\d+$/;

const createRelease = (label, date) => ({
  version: label.toLowerCase() === 'unreleased' ? null : label,
  date: date || null,
  categories: [],
  changes: [],
  commits: []
});

const parseCommits = (value) => {
  const normalized = value.trim();
  if (!normalized || normalized.toLowerCase() === 'none') return [];
  return normalized.split(',').map((commit) => commit.trim()).filter(Boolean);
};

export function parseChangelog(markdown) {
  if (typeof markdown !== 'string') {
    throw new TypeError('Changelog markdown must be a string');
  }

  const releases = [];
  let release = null;
  let category = null;

  const finishRelease = () => {
    if (release) releases.push(release);
  };

  for (const line of markdown.replace(/\r\n?/g, '\n').split('\n')) {
    const releaseMatch = line.match(RELEASE_HEADING);
    if (releaseMatch) {
      finishRelease();
      release = createRelease(releaseMatch[1].trim(), releaseMatch[2]);
      category = null;
      continue;
    }

    if (!release) continue;

    const categoryMatch = line.match(CATEGORY_HEADING);
    if (categoryMatch) {
      category = { name: categoryMatch[1].trim(), changes: [] };
      release.categories.push(category);
      continue;
    }

    const commitsMatch = line.match(COMMITS_LINE);
    if (commitsMatch) {
      release.commits = parseCommits(commitsMatch[1]);
      continue;
    }

    const changeMatch = line.match(CHANGE_ITEM);
    if (changeMatch && category) {
      const change = changeMatch[1].trim();
      category.changes.push(change);
      release.changes.push(change);
    }
  }

  finishRelease();
  return releases;
}

export const isFormalRelease = (release) => (
  typeof release?.version === 'string' && FORMAL_VERSION.test(release.version)
);

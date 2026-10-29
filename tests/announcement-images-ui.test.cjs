const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('announcement image snapshots remain optional and render responsively', () => {
  const management = read('src/features/admin/AnnouncementManagement.jsx');
  const content = read('src/features/announcements/AnnouncementContent.jsx');

  assert.match(management, /image_urls/);
  assert.match(management, /images: form\.image_urls/);
  assert.match(management, /announcement\.images/);
  assert.match(content, /Array\.isArray\(announcement\.images\)/);
  assert.match(content, /max-h-\[70vh\]/);
  assert.match(content, /target="_blank"/);
  assert.match(content, /object-contain/);
});


test('public announcement projection refreshes after admin edits', () => {
  const app = require('./helpers/app-source.cjs').readAppSource();
  assert.match(app, /const refreshPublicAnnouncements = async/);
  assert.match(app, /apiClient\.getMyAnnouncements/);
  assert.match(app, /normalizeAnnouncementInbox\(payload\)/);
  assert.match(app, /await loadAdminAnnouncements\(true\);[\s\S]*await refreshPublicAnnouncements\(\);/);
  assert.match(app, /<AnnouncementInbox[\s\S]*onRetry=\{\(\) => \{ void loadAnnouncementInbox\(\); \}\}/);
  assert.match(app, /shouldAutoPopup && !session\.shownIds\.has/);
  assert.match(app, /await loadAnnouncementInbox\(\{ queuePopups: false \}\)/);
  assert.match(app, /announcementPopup \|\| announcementPopupQueue\.length === 0/);
  assert.doesNotMatch(app, /<AnnouncementBar/);
});

test('announcement inbox does not render an empty result when loading failed', async () => {
  const { shouldShowAnnouncementEmptyState } = await import('../src/features/announcements/announcementInboxViewState.js');
  assert.equal(shouldShowAnnouncementEmptyState({ announcements: [] }), true);
  assert.equal(shouldShowAnnouncementEmptyState({ loading: true, announcements: [] }), false);
  assert.equal(shouldShowAnnouncementEmptyState({ error: 'temporary request failure', announcements: [] }), false);
  assert.equal(shouldShowAnnouncementEmptyState({ error: 'temporary request failure', announcements: [{ id: 'stale' }] }), false);
});

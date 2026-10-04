const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('announcement image snapshots remain optional and render responsively', () => {
  const management = read('src/features/admin/AnnouncementManagement.jsx');
  const modal = read('src/components/AnnouncementModal.jsx');

  assert.match(management, /image_urls/);
  assert.match(management, /images: form\.image_urls/);
  assert.match(management, /announcement\.images/);
  assert.match(modal, /Array\.isArray\(announcement\.images\)/);
  assert.match(modal, /max-h-\[70vh\]/);
  assert.match(modal, /target="_blank"/);
  assert.match(modal, /object-contain/);
});


test('public announcement projection refreshes after admin edits', () => {
  const app = read('src/App.jsx');
  assert.match(app, /const refreshPublicAnnouncements = async/);
  assert.match(app, /apiClient\.getCalendar/);
  assert.match(app, /normalizeDeferredAnnouncements\(data\?\.announcements\)/);
  assert.match(app, /await loadAdminAnnouncements\(true\);[\s\S]*await refreshPublicAnnouncements\(\);/);
});

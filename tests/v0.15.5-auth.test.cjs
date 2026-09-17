const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

test('fresh employee guest identity maps to onboarding even when the canonical user is not created yet', () => {
  const app = read('src/App.jsx');
  const onboarding = read('src/components/ProvisionalEmployeeOnboarding.jsx');
  const stateMapping = app.match(/const nextAuthState = identity\.identityState[\s\S]*?: AUTH_STATES\.UNREGISTERED;/)?.[0] || '';

  assert.match(stateMapping, /identity\.authMode === 'employee_guest'/);
  assert.match(stateMapping, /identity\.status === 'UNVERIFIED_EMPLOYEE'/);
  assert.match(stateMapping, /identity\.identityState === IDENTITY_STATES\.NEW_PROVISIONAL_EMPLOYEE/);
  assert.match(stateMapping, /AUTH_STATES\.UNVERIFIED/);
  assert.doesNotMatch(
    stateMapping,
    /identity\.authMode === 'employee_guest'\s*\n\s*&& identity\.user\s*\n\s*\? AUTH_STATES\.UNVERIFIED/
  );
  assert.match(app, /<ProvisionalEmployeeOnboarding/);
  assert.match(onboarding, /LINE 綁定為選用功能/);
});

test('fresh employee onboarding re-resolves the same guest session before normal UI', () => {
  const app = read('src/App.jsx');
  const onboarding = app.match(/const handleEmployeeGuestOnboarding = async[\s\S]*?\n  };/)?.[0] || '';

  assert.match(onboarding, /authBootCompletedRef\.current = false/);
  assert.match(onboarding, /initLiffAndFetchData\(\{ force: true, preferGuestSession: true \}\)/);
  assert.match(app, /if \(identity\?\.success && identity\.registered && identity\.user\)/);
  assert.match(app, /setAuthState\(AUTH_STATES\.REGISTERED\)/);
});

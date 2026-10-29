// Runs every frontend test file, minus the tests that drive a real Chromium window.
// Those tests skip themselves when no browser is found, but on a CI runner a browser exists and
// the DevTools connection is not set up for them, so they are run on a developer machine instead
// (see docs/UAT_WINDOWS_LOCAL_MOCK_INTEGRATION.md). Only those tests are left out, by name.
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const testsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'tests');
const BROWSER_TEST_NAMES = [
  'local mock UAT #103, #108, #111, and #121 works at phone and desktop widths',
  'Admin browser shows disabled vendor history without a transfer form',
  'Vendor local mock portal renders at phone and desktop widths without employee or wallet views'
];

const files = readdirSync(testsDir)
  .filter((name) => name.endsWith('.test.cjs'))
  .sort()
  .map((name) => path.join('tests', name));
const skipArgs = BROWSER_TEST_NAMES.flatMap((name) => ['--test-skip-pattern', `${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`]);

const result = spawnSync(process.execPath, ['--test', ...skipArgs, ...files], { stdio: 'inherit' });
process.exit(result.status ?? 1);

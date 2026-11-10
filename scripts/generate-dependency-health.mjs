// Build-time dependency health summary for the Admin "系統健康" page.
// Output: src/generated/dependency-health.json (git-ignored; no D1, no API, no migration).
// This script never fails the build: any problem produces a status of "unavailable".
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const KEY_PACKAGES = ['@line/liff', 'vite', 'react', 'react-dom', '@vitejs/plugin-react', 'tailwindcss', 'sweetalert2'];

const SEVERITY_RANK = { info: 1, low: 2, moderate: 3, high: 4, critical: 5 };

function advisoriesOf(entry) {
  return (entry?.via || [])
    .filter((v) => v && typeof v === 'object')
    .map((v) => ({ title: String(v.title || ''), url: String(v.url || ''), severity: String(v.severity || entry.severity || '') }));
}

// pure: audit = `npm audit --json`, outdated = `npm outdated --json`, installed = { name: version }
export function buildHealth({ audit, outdated, installed, now = new Date(), keyPackages = KEY_PACKAGES }) {
  const vulns = audit?.vulnerabilities || {};
  const packages = keyPackages.map((name) => {
    const current = installed[name] || '';
    const latest = outdated?.[name]?.latest || current;
    const vuln = vulns[name];
    const advisories = vuln ? advisoriesOf(vuln) : [];
    const status = vuln ? 'vulnerable' : (current && latest && current !== latest ? 'outdated' : 'ok');
    return { name, current, latest, status, severity: vuln?.severity || '', advisories };
  });
  const keySet = new Set(keyPackages);
  const otherVulnerable = Object.entries(vulns)
    .filter(([name]) => !keySet.has(name))
    .map(([name, v]) => ({ name, severity: v.severity || '' }))
    .sort((a, b) => (SEVERITY_RANK[b.severity] || 0) - (SEVERITY_RANK[a.severity] || 0));
  const rank = { ok: 0, outdated: 1, vulnerable: 2 };
  let overall = packages.reduce((w, p) => (rank[p.status] > rank[w] ? p.status : w), 'ok');
  if (otherVulnerable.length && overall === 'ok') overall = 'outdated';
  return { status: 'ready', generatedAt: now.toISOString(), overall, packages, otherVulnerable };
}

function runNpmJson(args) {
  const r = spawnSync('npm', args, { encoding: 'utf8', timeout: 60000, shell: process.platform === 'win32' });
  // npm audit/outdated exit non-zero when they find something; JSON is still on stdout.
  try { return JSON.parse(r.stdout); } catch { return null; }
}

function main() {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  const out = path.join(root, 'src', 'generated', 'dependency-health.json');
  let result = { status: 'unavailable', generatedAt: new Date().toISOString() };
  try {
    const installed = {};
    for (const name of KEY_PACKAGES) {
      try { installed[name] = JSON.parse(readFileSync(path.join(root, 'node_modules', name, 'package.json'), 'utf8')).version; } catch { /* missing */ }
    }
    const audit = runNpmJson(['audit', '--json']);
    const outdated = runNpmJson(['outdated', '--json']);
    if (audit && audit.vulnerabilities && outdated) result = buildHealth({ audit, outdated, installed });
  } catch { /* keep unavailable */ }
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`dependency-health: ${result.status}${result.overall ? ` (${result.overall})` : ''}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

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

// pure: audit = `npm audit --json`, latestMap = { name: latestVersion } (a missing name = lookup failed), installed = { name: version }
export function buildHealth({ audit, latestMap, installed, now = new Date(), keyPackages = KEY_PACKAGES }) {
  const vulns = audit?.vulnerabilities || {};
  const packages = keyPackages.map((name) => {
    const current = installed[name] || '';
    const latest = latestMap?.[name] || '';
    const vuln = vulns[name];
    const advisories = vuln ? advisoriesOf(vuln) : [];
    const status = vuln ? 'vulnerable' : (!current || !latest ? 'unknown' : (current !== latest ? 'outdated' : 'ok'));
    return { name, current, latest, status, severity: vuln?.severity || '', advisories };
  });
  const keySet = new Set(keyPackages);
  const otherVulnerable = Object.entries(vulns)
    .filter(([name]) => !keySet.has(name))
    .map(([name, v]) => ({ name, severity: v.severity || '' }))
    .sort((a, b) => (SEVERITY_RANK[b.severity] || 0) - (SEVERITY_RANK[a.severity] || 0));
  const rank = { ok: 0, unknown: 1, outdated: 1, vulnerable: 2 };
  let overall = packages.reduce((w, p) => (rank[p.status] > rank[w] ? p.status : w), 'ok');
  if (overall === 'unknown') overall = 'outdated';
  if (otherVulnerable.length && overall === 'ok') overall = 'outdated';
  return { status: 'ready', generatedAt: now.toISOString(), overall, packages, otherVulnerable };
}

function runAudit(cwd) {
  const r = spawnSync('npm', ['audit', '--json'], { cwd, encoding: 'utf8', timeout: 90000, shell: process.platform === 'win32' });
  // npm audit exits non-zero when it finds something; the JSON is still on stdout.
  try { return { data: JSON.parse(r.stdout) }; } catch {
    return { error: `npm audit failed (${r.error?.code ?? r.status ?? 'no output'}): ${String(r.stderr || '').trim().split('\n')[0].slice(0, 160)}` };
  }
}

// Latest versions come straight from the public registry (one small request per package), which
// avoids `npm outdated`, whose per-package spawning was killed on some Windows setups.
async function fetchLatest(names) {
  const latestMap = {};
  await Promise.all(names.map(async (name) => {
    try {
      const res = await fetch(`https://registry.npmjs.org/${name.replace('/', '%2F')}/latest`, { signal: AbortSignal.timeout(15000), headers: { accept: 'application/json' } });
      const version = res.ok ? (await res.json()).version : '';
      if (version) latestMap[name] = version;
    } catch { /* leave unknown */ }
  }));
  return latestMap;
}

// Never throws: any problem yields status "unavailable" with a short reason shown on the page.
export async function generate(root) {
  const out = path.join(root, 'src', 'generated', 'dependency-health.json');
  let result = { status: 'unavailable', generatedAt: new Date().toISOString(), reason: 'unknown' };
  try {
    const installed = {};
    for (const name of KEY_PACKAGES) {
      try { installed[name] = JSON.parse(readFileSync(path.join(root, 'node_modules', name, 'package.json'), 'utf8')).version; } catch { /* missing */ }
    }
    const audit = runAudit(root);
    const latestMap = await fetchLatest(KEY_PACKAGES);
    if (audit.data?.vulnerabilities) result = buildHealth({ audit: audit.data, latestMap, installed });
    else result.reason = audit.error || `npm audit returned no vulnerabilities field${audit.data?.error ? `: ${audit.data.error.code}` : ''}`;
  } catch (e) { result.reason = String(e?.message || e).slice(0, 160); }
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  generate(path.join(path.dirname(fileURLToPath(import.meta.url)), '..')).then((result) => {
    console.log(`dependency-health: ${result.status}${result.overall ? ` (${result.overall})` : ''}${result.reason ? ` - ${result.reason}` : ''}`);
  });
}

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const REQUIRED_CRONS = ['0 16 * * *', '0 8 * * *', '0 10 * * *', '0 2 * * *', '30 0 15 6-12 *'];
const EXPECTED_D1 = 'e75bc185-afb5-4a5d-abc9-81bd79525cff';
const normalize = value => JSON.stringify(value);

export function assertSameSettings(before, after) {
  for (const key of ['compatibility_date', 'usage_model']) {
    if (before[key] !== after[key]) throw new Error('SETTING_CHANGED:' + key);
  }
  const compact = rows => (rows || []).map(b => ({
    name: b.name, type: b.type, id: b.id ?? b.database_id ?? null,
    namespace_id: b.namespace_id ?? null
  })).sort((a,b) => a.name.localeCompare(b.name));
  const first = compact(before.bindings);
  const second = compact(after.bindings);
  if (normalize(first) !== normalize(second)) throw new Error('BINDINGS_CHANGED');
  if (!first.some(b => b.name === 'DB' && b.type === 'd1' && b.id === EXPECTED_D1)) {
    throw new Error('FORMAL_D1_MISSING');
  }
}

export function assertSameNames(before, after, type) {
  const normalized = list => [...new Set(list)].sort().join('|');
  if (normalized(before) !== normalized(after)) throw new Error(type + '_CHANGED');
}
export function makeMultipart(manifest, rootDir, read = readFileSync) {
  if (!manifest || !Array.isArray(manifest.files) || !manifest.files.length || !manifest.mainModule) {
    throw new Error('INCOMPLETE_BUNDLE_MANIFEST');
  }
  if (manifest.status !== 'BUILT_NOT_DEPLOYED' || !/^[a-f0-9]{40}$/.test(manifest.sourceSha || '')) {
    throw new Error('SOURCE_PROOF_MISSING');
  }
  const names = new Set();
  const form = new FormData();
  const metadata = {
    main_module: manifest.mainModule,
    bindings: (manifest.bindings || []).map(b => ({ type: 'inherit', name: b.name })),
    compatibility_date: manifest.compatibilityDate,
    annotations: { 'workers/commit_sha': manifest.sourceSha, 'workers/message': 'Formal Worker build ' + manifest.sourceSha }
  };
  if (!manifest.bindings?.some(b => b.name === 'DB' && b.type === 'd1' && b.id === EXPECTED_D1)) {
    throw new Error('INHERITANCE_PROOF_MISSING');
  }
  if (!manifest.compatibilityDate || !manifest.files.some(f => f.path === manifest.mainModule)) {
    throw new Error('MAIN_MODULE_MISSING');
  }
  for (const f of manifest.files) {
    if (!f.path || names.has(f.path) || f.path.includes('..') || f.path.startsWith('/') || f.path.includes('\\')) {
      throw new Error('INVALID_MODULE_PATH');
    }
    names.add(f.path);
    if (!Number.isInteger(f.bytes) || f.bytes < 1 || !/^[a-f0-9]{64}$/.test(f.sha256)) {
      throw new Error('MODULE_PROOF_MISSING:' + f.path);
    }
    const absolute = resolve(rootDir, f.path);
    if (!absolute.startsWith(resolve(rootDir) + sep)) throw new Error('MODULE_PATH_ESCAPE');
    const data = read(absolute);
    if (data.length !== f.bytes || digest(data) !== f.sha256) throw new Error('MODULE_HASH_MISMATCH:' + f.path);
    const mime = f.mime || (f.path.endsWith('.wasm') ? 'application/wasm'
      : f.path.endsWith('.js') || f.path.endsWith('.mjs') ? 'application/javascript+module'
      : f.path.endsWith('.map') ? 'application/source-map' : 'text/plain');
    form.append(f.path, new Blob([data], { type: mime }), f.path);
  }
  form.append('metadata', JSON.stringify(metadata));
  return { form, metadata, moduleCount: names.size };
}
export async function getJson(base, token, path, method = 'GET', body) {
  const response = await fetch(base + path, { method, headers: { Authorization: 'Bearer ' + token }, ...(body ? {body} : {}) });
  const data = await response.json();
  if (!response.ok || !data.success) throw new Error('CF_API_' + method + '_' + path.split('?')[0] + '_' + response.status);
  return data.result;
}
export function versionSettings(version) {
  const resources=version?.resources;
  if (!resources || !Array.isArray(resources.bindings) || !resources.script_runtime) throw new Error('VERSION_RESOURCES_UNAVAILABLE');
  const runtime=resources.script_runtime;
  return { bindings: resources.bindings, compatibility_date: runtime.compatibility_date, usage_model: runtime.usage_model };
}
export async function verifyVersionSettings(before, version, secretsBefore, secretsAfter, cronsBefore, cronsAfter) {
  assertSameSettings(before, versionSettings(version));
  assertSameNames(secretsBefore, secretsAfter, 'SECRETS');
  assertSameNames(cronsBefore, cronsAfter, 'CRONS');
  assertSameNames(REQUIRED_CRONS, cronsAfter, 'REQUIRED_CRONS');
  return true;
}
export async function main(env = process.env) {
  const manifestFile = env.BENTO_RELEASE_MANIFEST;
  if (!manifestFile) throw new Error('BENTO_RELEASE_MANIFEST_REQUIRED');
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
  const root = resolve(manifestFile, '..');
  const prepared = makeMultipart(manifest, root);
  const proof = { sourceSha: manifest.sourceSha, moduleCount: prepared.moduleCount, metadata: prepared.metadata, status: 'DRY_RUN_ONLY' };
  if (env.BENTO_UPLOAD_VERSION !== 'true') return proof;
  const token = env.CLOUDFLARE_API_TOKEN, account = env.CLOUDFLARE_ACCOUNT_ID;
  if (!token || !account) throw new Error('CF_CREDENTIALS_REQUIRED');
  const base = 'https://api.cloudflare.com/client/v4';
  const path = '/accounts/' + encodeURIComponent(account) + '/workers/scripts/bento-api-poc';
  const before = await getJson(base, token, path + '/settings');
  const secretsBefore = (await getJson(base, token, path + '/secrets')).map(s => s.name);
  const cronBefore = (await getJson(base, token, path + '/schedules')).schedules.map(s => s.cron);
  const deployments = await getJson(base, token, path + '/deployments');
  const currentVersion = deployments.deployments?.[0]?.versions?.find(v => v.percentage === 100)?.version_id;
  const versions = await getJson(base, token, path + '/versions');
  const latestUploaded = versions.items?.[0]?.id ?? (Array.isArray(versions) ? versions[0]?.id : null);
  if (!currentVersion || !latestUploaded || latestUploaded !== currentVersion) throw new Error('INHERITANCE_BASE_NOT_DEPLOYED');
  assertSameSettings(before, { ...before, bindings: manifest.bindings });
  const uploaded = await getJson(base, token, path + '/versions?bindings_inherit=strict', 'POST', prepared.form);
  const newVersionId = uploaded.id;
  if (!newVersionId || newVersionId === currentVersion) throw new Error('VERSION_UPLOAD_NOT_CONFIRMED');
  const version = await getJson(base, token, path + '/versions/' + encodeURIComponent(newVersionId));
  const secretsAfter = (await getJson(base, token, path + '/secrets')).map(s => s.name);
  const cronAfter = (await getJson(base, token, path + '/schedules')).schedules.map(s => s.cron);
  await verifyVersionSettings(before, version, secretsBefore, secretsAfter, cronBefore, cronAfter);
  return { ...proof, status: 'VERSION_UPLOADED_VERIFIED_NOT_DEPLOYED', newVersionId };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(v => console.log(JSON.stringify(v, null, 2))).catch(error => {
    console.error('RELEASE_BLOCKED=' + error.message);process.exitCode = 1;
  });
}

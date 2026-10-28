import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { digest, makeMultipart, assertSameSettings, assertSameNames, versionSettings, verifyVersionSettings } from '../scripts/upload-formal-version.mjs';

const make = () => {
  const dir = mkdtempSync(join(tmpdir(), 'cf-upload-'));
  const bytes = Buffer.from('export default { fetch() { return new Response("ok") } };');
  writeFileSync(join(dir, 'main.js'), bytes);
  const manifest = {
    status: 'BUILT_NOT_DEPLOYED', sourceSha: 'a'.repeat(40), mainModule: 'main.js',
    compatibilityDate: '2026-09-07',
    bindings: [{ name: 'DB', type: 'd1', id: 'e75bc185-afb5-4a5d-abc9-81bd79525cff' }],
    files: [{ path: 'main.js', bytes: bytes.length, sha256: digest(bytes), mime: 'application/javascript+module' }]
  };
  return { dir, manifest };
};
test('multipart includes verifiable main module and metadata', async () => {
  const {dir,manifest}=make();
  try {
    const x=makeMultipart(manifest,dir);
    assert.equal(x.moduleCount,1);
    assert.equal(x.metadata.main_module,'main.js');
    assert.equal(x.metadata.bindings[0].type,'inherit');
    assert.equal(await x.form.get('main.js').text(),'export default { fetch() { return new Response("ok") } };');
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
test('multipart includes every module, not only main', () => {
  const {dir,manifest}=make();
  try {
    const b=Buffer.from('export const a = 1');
    writeFileSync(join(dir,'extra.js'),b);
    manifest.files.push({path:'extra.js',bytes:b.length,sha256:digest(b)});
    const x=makeMultipart(manifest,dir);
    assert.equal(x.moduleCount,2);
    assert.ok(x.form.has('extra.js'));
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
test('missing modules, stale hashes, and ambiguous paths fail closed', () => {
  const {dir,manifest}=make();
  try {
    manifest.files[0].sha256='0'.repeat(64);
    assert.throws(()=>makeMultipart(manifest,dir),/MODULE_HASH_MISMATCH/);
    manifest.files[0].sha256=digest(Buffer.from('export default { fetch() { return new Response("ok") } };'));
    manifest.files.push({...manifest.files[0],path:'../escape.js'});
    assert.throws(()=>makeMultipart(manifest,dir),/INVALID_MODULE_PATH/);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
test('post-upload D1/compatibility and named secrets/cron mismatches block release', () => {
  const before={compatibility_date:'2026-09-07',usage_model:'standard',bindings:[{name:'DB',type:'d1',id:'e75bc185-afb5-4a5d-abc9-81bd79525cff'}]};
  assert.doesNotThrow(()=>assertSameSettings(before,{...before}));
  assert.throws(()=>assertSameSettings(before,{...before,bindings:[]}),/BINDINGS_CHANGED/);
  assert.throws(()=>assertSameNames(['A'],[],'SECRETS'),/SECRETS_CHANGED/);
  assert.throws(()=>assertSameNames(['0 16 * * *'],[],'CRONS'),/CRONS_CHANGED/);
});

test('Cloudflare version resources are used, not the version root', async () => {
  const before={compatibility_date:'2026-09-07',usage_model:'standard',bindings:[{name:'DB',type:'d1',id:'e75bc185-afb5-4a5d-abc9-81bd79525cff'}]};
  const version={id:'version',resources:{bindings:before.bindings,script_runtime:{compatibility_date:before.compatibility_date,usage_model:before.usage_model}}};
  assert.deepEqual(versionSettings(version), before);
  await assert.doesNotReject(verifyVersionSettings(before,version,[],[],['0 16 * * *','0 8 * * *','0 2,10 * * *','50 1,9 * * *','30 0 15 6-12 *'],['0 16 * * *','0 8 * * *','0 2,10 * * *','50 1,9 * * *','30 0 15 6-12 *']));
  assert.rejects(verifyVersionSettings(before,{id:'version'},[],[],[],[]),/VERSION_RESOURCES_UNAVAILABLE/);
});

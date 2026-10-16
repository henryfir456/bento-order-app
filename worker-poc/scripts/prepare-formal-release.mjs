// Fail-closed release preparation: no upload, no secrets, no production changes.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, relative, join } from 'node:path';
const root=resolve(import.meta.dirname,'..','..');
const api=resolve(root,'worker-poc');
const run=(bin,args,cwd=root)=>execFileSync(bin,args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const sha=run('git',['rev-parse','HEAD']);
const branch=run('git',['branch','--show-current']);
if(branch!=='main')throw new Error('BLOCKED: release preparation requires main');
if(run('git',['status','--porcelain']))throw new Error('BLOCKED: worktree is not clean');
const config=readFileSync(join(api,'wrangler.jsonc'),'utf8');
for(const value of ['"name": "bento-api-poc"','"main": "src/formalWorker.js"','"database_name": "bento-formal"','"binding": "DB"','"compatibility_date": "2026-09-07"','e75bc185-afb5-4a5d-abc9-81bd79525cff']) {
  if(!config.includes(value))throw new Error('BLOCKED: Wrangler config mismatch: '+value);
}
const out=resolve(api,'.release-evidence');
mkdirSync(out,{recursive:true});
const created=run('npx',['wrangler','deploy','--dry-run','--outdir',out,'--config','wrangler.jsonc'],api);
const files=[];
function visit(dir){for(const name of readdirSync(dir)){const p=join(dir,name);if(statSync(p).isDirectory())visit(p);else if(name !== 'release-manifest.json' && name !== 'metadata.json'){const bytes=readFileSync(p);files.push({path:relative(out,p).replaceAll('\\','/'),sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,mime:/\\.wasm$/.test(name)?'application/wasm':/\\.(js|mjs)$/.test(name)?'application/javascript+module':/\\.map$/.test(name)?'application/source-map':'application/octet-stream'});}}}
visit(out);
if(!files.some(f=>f.path.endsWith('.js')&&f.bytes>0))throw new Error('BLOCKED: Worker bundle missing');
// Wrangler's metadata is authoritative; never guess the entry by counting .js files.
const metadataPath=join(out,'metadata.json');
if(!existsSync(metadataPath)) throw new Error('BLOCKED: Wrangler module metadata unavailable');
const buildMetadata=JSON.parse(readFileSync(metadataPath,'utf8'));
const mainModule=buildMetadata.main_module;
if(typeof mainModule!=='string' || !files.some(f=>f.path===mainModule)) {
  throw new Error('BLOCKED: Wrangler main_module not present in complete bundle');
}
if(!/\.(js|mjs)$/.test(mainModule)) throw new Error('BLOCKED: invalid Wrangler entry module');
const evidence={mainModule,bindings:[{name:'DB',type:'d1',id:'e75bc185-afb5-4a5d-abc9-81bd79525cff'}],compatibilityDate:'2026-09-07',status:'BUILT_NOT_DEPLOYED',sourceSha:sha,worker:'bento-api-poc',configuration:'worker-poc/wrangler.jsonc',files,generatedAt:new Date().toISOString(),uploadVerification:'NOT_RUN',productionDeployment:'NOT_RUN',smoke:'NOT_RUN'};
writeFileSync(join(out,'release-manifest.json'),JSON.stringify(evidence,null,2)+'\n');
console.log(JSON.stringify({sourceSha:sha,bundles:files.length,evidence:join(out,'release-manifest.json'),wranglerDryRun:created.slice(-500)},null,2));

// Direct release runner. No GitHub Actions, no CI artifact dependency.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { main as upload } from './upload-formal-version.mjs';
import { assertFormalReleaseD1Ready, runFormalDrift } from './detect-formal-drift.mjs';

const worker=resolve(import.meta.dirname,'..');
const root=resolve(worker,'..');
const exec=(command,args,cwd=root)=>execFileSync(command,args,{cwd,stdio:'inherit',env:{...process.env,CI:'1'}});
const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();

export function assertReleaseSource({ branch, clean, head, upstream }) {
  if(branch!=='main'||clean||!head||head!==upstream) throw new Error('BLOCKED: release requires clean up-to-date origin/main');
}
export function assertUploadEvidence(evidence,manifest) {
  if(evidence.status!=='VERSION_UPLOADED_VERIFIED_NOT_DEPLOYED'||!evidence.newVersionId ||
    evidence.sourceSha!==manifest.sourceSha) throw new Error('BLOCKED: verified new version missing');
  if(manifest.status!=='BUILT_NOT_DEPLOYED')throw new Error('BLOCKED: fresh build manifest invalid');
}
export async function runRelease({ env=process.env, uploadImpl=upload, apiFetch=fetch }={}) {
  const evidenceDir=join(worker,'.release-evidence');
  if(env.BENTO_RELEASE_MODE!=='deploy') {
    return {status:'DRY_RUN_NO_DEPLOY',next:'BENTO_RELEASE_MODE=deploy required for a real release'};
  }
  if(env.BENTO_RELEASE_CONFIRM!=='bento-api-poc')throw new Error('BLOCKED: explicit Worker confirmation missing');
  if(!env.CLOUDFLARE_API_TOKEN||!env.CLOUDFLARE_ACCOUNT_ID)throw new Error('BLOCKED: direct Cloudflare credentials required');
  exec('git',['fetch','--quiet','origin','main']);
  assertReleaseSource({branch:git('branch','--show-current'),clean:git('status','--porcelain'),
    head:git('rev-parse','HEAD'),upstream:git('rev-parse','origin/main')});
  exec('npm',['ci']);
  exec('npm',['run','lint']);
  exec('npm',['run','build']);
  exec('npm',['ci','--prefix','worker-poc']);
  exec('npm',['test','--prefix','worker-poc']);
  exec('node',['scripts/prepare-formal-release.mjs'],worker);
  const manifestFile=join(evidenceDir,'release-manifest.json');
  const manifest=JSON.parse(readFileSync(manifestFile,'utf8'));
  if(manifest.sourceSha!==git('rev-parse','HEAD'))throw new Error('BLOCKED: manifest SHA mismatch');
  const drift=await runFormalDrift({env,fetchImpl:apiFetch});
  assertFormalReleaseD1Ready(drift);
  const proof=await uploadImpl({...env,BENTO_RELEASE_MANIFEST:manifestFile,BENTO_UPLOAD_VERSION:'true'});
  assertUploadEvidence(proof,manifest);
  // No upload result is sufficient to release if the configured production
  // identity differs or the account has moved since the last upload.
  const base='https://api.cloudflare.com/client/v4/accounts/'+encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID)
    +'/workers/scripts/bento-api-poc';
  const auth={'Authorization':'Bearer '+env.CLOUDFLARE_API_TOKEN,'Content-Type':'application/json'};
  const response=await apiFetch(base+'/deployments',{method:'POST',headers:auth,body:JSON.stringify({
    strategy:'percentage',versions:[{version_id:proof.newVersionId,percentage:100}]
  })});
  const result=await response.json();
  if(!response.ok||!result.success||!result.result?.id)throw new Error('BLOCKED: Cloudflare deployment not confirmed');
  const check=await apiFetch(base+'/deployments',{headers:{Authorization:auth.Authorization}});
  const deployed=await check.json();
  const actual=deployed.result?.deployments?.[0];
  if(!check.ok||!deployed.success||actual?.id!==result.result.id||
    actual?.versions?.length!==1||actual.versions[0]?.version_id!==proof.newVersionId||
    actual.versions[0]?.percentage!==100)throw new Error('BLOCKED: production traffic verification failed');
  mkdirSync(evidenceDir,{recursive:true});
  const evidence={sourceSha:manifest.sourceSha,newVersionId:proof.newVersionId,deploymentId:actual.id,
    migrationVersion:drift.database.appliedLatestMigration,driftStatus:drift.status,
    trafficPercent:100,smoke:'PENDING',status:'DEPLOYED_AWAITING_SMOKE'};
  writeFileSync(join(evidenceDir,'deployment-result.json'),JSON.stringify(evidence,null,2)+'\n');
  if(!env.BENTO_WORKER_BASE_URL)throw new Error('BLOCKED: HTTP smoke URL missing; deployment completed, smoke NOT VERIFIED');
  exec('node',['scripts/formal-release-smoke.mjs'],worker);
  exec('node',['scripts/remote-cors-smoke.mjs'],worker);
  evidence.smoke='PASS_ANONYMOUS_CORS_VIEW_AS_IF_CREDENTIALS_SET';
  evidence.status='DEPLOYED_SMOKE_PASS';
  writeFileSync(join(evidenceDir,'deployment-result.json'),JSON.stringify(evidence,null,2)+'\n');
  return evidence;
}
if(import.meta.url===new URL('file://'+process.argv[1]).href) {
  runRelease().then(v=>console.log(JSON.stringify(v))).catch(e=>{console.error(e.message);process.exitCode=1});
}

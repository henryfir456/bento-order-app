import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assertReleaseSource,assertUploadEvidence,runRelease} from '../scripts/release-formal-worker.mjs';

test('requires clean, current main source',()=>{
 assert.doesNotThrow(()=>assertReleaseSource({branch:'main',clean:'',head:'a',upstream:'a'}));
 for(const item of [{branch:'feature',clean:'',head:'a',upstream:'a'},
  {branch:'main',clean:' M src/a',head:'a',upstream:'a'},
  {branch:'main',clean:'',head:'a',upstream:'b'}])
  assert.throws(()=>assertReleaseSource(item),/BLOCKED/);
});
test('prohibit unverified version or mismatched source SHA',()=>{
 const manifest={status:'BUILT_NOT_DEPLOYED',sourceSha:'abc'};
 assert.doesNotThrow(()=>assertUploadEvidence({status:'VERSION_UPLOADED_VERIFIED_NOT_DEPLOYED',newVersionId:'new',sourceSha:'abc'},manifest));
 assert.throws(()=>assertUploadEvidence({status:'DRY_RUN_ONLY',sourceSha:'abc',newVersionId:'new'},manifest),/BLOCKED/);
 assert.throws(()=>assertUploadEvidence({status:'VERSION_UPLOADED_VERIFIED_NOT_DEPLOYED',sourceSha:'other',newVersionId:'new'},manifest),/BLOCKED/);
});
test('direct release defaults to dry-run without external calls',async()=>{
 const result=await runRelease({env:{},apiFetch:()=>{throw Error('MUST NOT CALL NETWORK')}});
 assert.equal(result.status,'DRY_RUN_NO_DEPLOY');
});
test('missing explicit confirmation rejects before external calls',async()=>{
 await assert.rejects(runRelease({env:{BENTO_RELEASE_MODE:'deploy'},apiFetch:()=>{throw Error('MUST NOT CALL NETWORK')}}),/confirmation missing/);
});

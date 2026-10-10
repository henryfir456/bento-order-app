const assert=require('node:assert/strict');
const {test}=require('node:test');
const load=()=>import('../src/features/vendorOrders/vendorOrderWorkflow.js');
const response=body=>Response.json({success:true,...body});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const draft={batchId:'batch',branchId:'branch',state:'DRAFT',revision:1,snapshotHash:'hash',snapshot:{warnings:[],sourceItems:[],sourceNotes:[],rows:[]}};
const api=overrides=>({getVendorOrderAccess:async()=>response({canConfigure:true,branches:[{branchId:'branch',policy:{floors:['1F']}}]}),getVendors:async()=>response({vendors:[]}),listVendorOrderBatches:async()=>response({batches:[]}),prepareVendorOrderBatch:async()=>response(draft),...overrides});
test('late preparation cannot repopulate an obsolete branch/date selection',async()=>{
  const {createVendorOrderWorkflow}=await load(),pending=deferred(),flow=createVendorOrderWorkflow(api({prepareVendorOrderBatch:()=>pending.promise}));
  flow.select({branchId:'branch',serviceDate:'2026-10-11',floors:['1F']});const work=flow.prepare();
  flow.select({branchId:'other',serviceDate:'2026-10-12',floors:['2F']});pending.resolve(response(draft));await work;
  assert.equal(flow.getSnapshot().batch,null);assert.equal(flow.getSnapshot().selection.branchId,'other');
});
test('repeated final clicks reserve once; lost response recovers with GET and never automatic POST',async()=>{
  const {createVendorOrderWorkflow}=await load();let claims=0,details=0,sheets=0;const pending=deferred();
  const flow=createVendorOrderWorkflow(api({reviewVendorOrderBatch:async()=>response({...draft,state:'READY',revision:2}),handoffVendorOrderBatch:()=>{claims++;return pending.promise;},getVendorOrderBatch:async()=>{details++;return response({...draft,state:'SUBMITTING',revision:3,attempt:{attemptId:'attempt'}});},getVendorOrderSheet:async()=>{sheets++;return response({...draft,state:'SUBMITTING',revision:3,sheet:{kind:'MANUAL_HANDOFF'}});}}));
  flow.select({branchId:'branch',serviceDate:'2026-10-11',floors:['1F']});await flow.prepare();await flow.review();
  const first=flow.handoff(true),second=flow.handoff(true);pending.reject(new Error('lost'));await Promise.all([first,second]);
  assert.equal(claims,1);assert.equal(details,1);assert.equal(sheets,1);assert.equal(flow.getSnapshot().batch.state,'SUBMITTING');
  await flow.handoff(true);assert.equal(claims,1);
});
test('UNKNOWN and unresolved claim cannot reserve again; explicit read-only reconciliation works',async()=>{
  const {createVendorOrderWorkflow}=await load();let claims=0;
  const flow=createVendorOrderWorkflow(api({getVendorOrderBatch:async()=>response({...draft,state:'UNKNOWN',attempt:{}}),getVendorOrderSheet:async()=>response({...draft,state:'UNKNOWN',sheet:{}}),handoffVendorOrderBatch:async()=>{claims++;return response(draft);}}));
  await flow.openBatch('batch');await flow.handoff(true);assert.equal(claims,0);assert.equal(flow.getSnapshot().batch.state,'UNKNOWN');
});
test('source notes acknowledgement is hash-bound and clear selection removes protected data',async()=>{
  const {createVendorOrderWorkflow}=await load();const submitted=[];
  const flow=createVendorOrderWorkflow(api({prepareVendorOrderBatch:async body=>{submitted.push(body);return response({...draft,snapshot:{...draft.snapshot,sourceNotes:[{sourceOrderId:'o',sourceNoteHash:'notehash',note:'private'}]}});}}));
  flow.select({branchId:'branch',serviceDate:'2026-10-11',floors:['1F']});await flow.prepare();flow.reviewNote('o',true,'No chili');await flow.prepare();
  assert.deepEqual(submitted[1].noteReviews,[{sourceOrderId:'o',sourceNoteHash:'notehash',reviewed:true,supplierNote:'No chili'}]);
  flow.dispose();assert.equal(flow.getSnapshot().batch,null);
});
test('authorization rejection clears batch, sheet and protected notes',async()=>{
  const {createVendorOrderWorkflow}=await load();const flow=createVendorOrderWorkflow(api({getVendorOrderBatch:async()=>{const error=new Error('forbidden');error.status=403;throw error;}}));
  flow.select({branchId:'branch',serviceDate:'2026-10-11',floors:['1F']});await flow.prepare();await flow.openBatch('batch');
  assert.equal(flow.getSnapshot().batch,null);assert.equal(flow.getSnapshot().sheet,null);assert.equal(flow.getSnapshot().access,null);
});
test('edited source-note review must be frozen in a new snapshot before approval or reservation',async()=>{
  const {createVendorOrderWorkflow}=await load();let reviews=0,claims=0;
  const flow=createVendorOrderWorkflow(api({prepareVendorOrderBatch:async()=>response({...draft,snapshot:{...draft.snapshot,sourceNotes:[{sourceOrderId:'o',sourceNoteHash:'h',note:'private'}]}}),reviewVendorOrderBatch:async()=>{reviews++;return response({...draft,state:'READY'});},handoffVendorOrderBatch:async()=>{claims++;return response(draft);}}));
  flow.select({branchId:'branch',serviceDate:'2026-10-11',floors:['1F']});await flow.prepare();flow.reviewNote('o',true,'Changed');await flow.review();await flow.handoff(true);
  assert.equal(reviews,0);assert.equal(claims,0);assert.equal(flow.getSnapshot().notesDirty,true);
});
test('effect cleanup invalidates old work; reactivation permits fresh strict-mode initialization',async()=>{
  const {createVendorOrderWorkflow}=await load();const old=deferred();let calls=0;
  const flow=createVendorOrderWorkflow(api({getVendorOrderAccess:()=>++calls===1?old.promise:Promise.resolve(response({canConfigure:false,branches:[]}))}));
  const first=flow.load();flow.dispose();flow.activate();await flow.load();old.resolve(response({canConfigure:true,branches:[{branchId:'stale'}]}));await first;
  assert.equal(flow.getSnapshot().access.canConfigure,false);assert.deepEqual(flow.getSnapshot().access.branches,[]);
});
test('UI entry uses authenticated LINE role and rejects guests, users, GAS and View As',async()=>{
  const {vendorOrderUiAllowed}=await load();
  for(const role of ['Admin','ProxyAdmin'])assert.equal(vendorOrderUiAllowed({transport:'worker',role,authMode:'line',viewAs:false}),true);
  for(const patch of [{role:'User'},{authMode:'employee_guest'},{viewAs:true},{transport:'gas'}])assert.equal(vendorOrderUiAllowed({transport:'worker',role:'Admin',authMode:'line',viewAs:false,...patch}),false);
});
test('Worker adapter uses existing credential priority, exact body/key and no View As or GAS fallback',async()=>{
  const {createApiClient}=await import('../src/api/apiClientCore.js');const calls=[];let lineReads=0;
  const client=createApiClient({env:{VITE_WORKER_API_URL:'https://worker.test',VITE_API_TRANSPORT:'worker'},authClient:{getAccessToken:()=>{lineReads++;return 'line-token';}},sessionStore:{getGuestSession:()=>({token:'guest-token'})},fetchImpl:async(url,options)=>{calls.push({url,options});return response({});}});
  const body={adapter:'MANUAL',confirm:true,snapshotHash:'h'};await client.handoffVendorOrderBatch('batch /?',body,'stable-key');await client.getVendorOrderSheet('batch');await client.configureVendorOrderMapping('branch',{menuItemId:'mi',variantKey:'HALF'});
  assert.equal(calls[0].options.headers.Authorization,'Bearer guest-token');assert.equal(lineReads,0);
  assert.equal(calls[0].options.headers['Idempotency-Key'],'stable-key');assert.deepEqual(JSON.parse(calls[0].options.body),body);
  assert.ok(calls[0].url.endsWith('/api/vendor-orders/batches/batch%20%2F%3F/handoff'));assert.equal(calls[1].options.method,'GET');
  assert.ok(calls.every(c=>!c.url.includes('viewAs')&&!c.url.includes('viewAsUserId')));
  let gasCalls=0;const gas=createApiClient({env:{VITE_API_TRANSPORT:'gas',VITE_GAS_API_URL:'https://gas.test'},authClient:{getAccessToken:()=>''},gasApi:{get:()=>gasCalls++,post:()=>gasCalls++}});
  assert.throws(()=>gas.prepareVendorOrderBatch(body),error=>error.code==='VENDOR_ORDERS_UNSUPPORTED_TRANSPORT');assert.equal(gasCalls,0);
});
test('real Worker route bodies load through createApiClient without a synthetic success envelope',async()=>{
  const {createApiClient}=await import('../src/api/apiClientCore.js');
  const {createVendorOrderWorkflow}=await load();
  const {handleFormalRequest}=await import('../worker-poc/src/formalWorker.js');
  const {SqliteD1}=await import('../worker-poc/tests/helpers/formal-db.js');
  const {seedUser,seedVendor,profileFetch}=await import('../worker-poc/tests/helpers/formal-fixtures.js');
  const db=new SqliteD1();seedUser(db,{lineUserId:'admin',role:'Admin'});seedVendor(db,{vendorId:'vendor',name:'Synthetic vendor'});
  const client=createApiClient({env:{VITE_WORKER_API_URL:'https://worker.test',VITE_API_TRANSPORT:'worker'},authClient:{getAccessToken:()=> 'local-fixture'},fetchImpl:(url,options)=>handleFormalRequest(new Request(url,options),{DB:db},{now:new Date(),fetchImpl:profileFetch({token:'local-fixture',lineUserId:'admin'})})});
  const flow=createVendorOrderWorkflow(client);await flow.load();
  assert.equal(flow.getSnapshot().error,'');assert.equal(flow.getSnapshot().access?.canConfigure,true);
  assert.equal(flow.getSnapshot().vendors[0].id,'vendor');
});
test('successful access refresh with a revoked branch clears previously protected data',async()=>{
  const {createVendorOrderWorkflow}=await load();let reads=0;
  const flow=createVendorOrderWorkflow(api({getVendorOrderAccess:async()=>response({canConfigure:false,branches:++reads===1?[{branchId:'branch'}]:[]})}));
  await flow.load();flow.select({branchId:'branch',serviceDate:'2026-10-11',floors:['1F']});await flow.prepare();assert.ok(flow.getSnapshot().batch);
  await flow.load();assert.equal(flow.getSnapshot().batch,null);assert.equal(flow.getSnapshot().sheet,null);assert.equal(flow.getSnapshot().selection.branchId,'');
});
test('malformed 403 response still clears protected data and exposes a safe format error',async()=>{
  const {createVendorOrderWorkflow}=await load();const flow=createVendorOrderWorkflow(api({getVendorOrderBatch:async()=>new Response('not-json',{status:403})}));
  flow.select({branchId:'branch',serviceDate:'2026-10-11',floors:['1F']});await flow.prepare();await flow.openBatch('batch');
  assert.equal(flow.getSnapshot().batch,null);assert.equal(flow.getSnapshot().sheet,null);
});

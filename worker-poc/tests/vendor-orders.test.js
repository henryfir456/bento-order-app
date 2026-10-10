import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handleFormalRequest } from '../src/formalWorker.js';
import { SqliteD1 } from './helpers/formal-db.js';
import { profileFetch, request, seedUser, seedVendor, seedMenuVersion, seedLedgerRow } from './helpers/formal-fixtures.js';
import { getTaipeiDate } from '../src/domain/deadlines.js';
import { HISTORICAL_SQL_VENDOR } from '../src/domain/menuVendors.js';
import { policyWarnings,policyWindow,validatePolicy } from '../src/domain/vendorOrderPolicy.js';
import { MAIFOOD_OFFICIAL_API,MANUAL } from '../src/domain/vendorOrderAdapters.js';
import { createGuestSession } from '../src/auth/guestSession.js';

const NOW = new Date();
const DATE = getTaipeiDate(new Date(NOW.getTime() + 86400000));
const policy = () => ({
  enabled: true, onlineOrderingConfirmed: true, addressConfirmed: true,
  address: 'Synthetic office', floors: ['1F', '2F'], serviceDates: [DATE],
  weekdays: [0,1,2,3,4,5,6], closedDates: [], internalMode: 'B',
  internalCutoff: '00:00', externalCutoff: '10:30', deliveryStart: '11:00', deliveryEnd: '13:00',
  minimumAmount: 0, freeShippingThreshold: 0, shippingFee: 30,
  paymentResponsibility: 'ORGANIZER_SETTLES_VENDOR', supplierNote: 'Reviewed common note'
});
const fixture = () => {
  const db = new SqliteD1();
  for (const [id, role] of [['admin','Admin'],['admin2','Admin'],['proxy','ProxyAdmin'],['member','User'],['member2','User']]) {
    seedUser(db, {lineUserId:id,role,displayName:'Private employee '+id,balance:321});
  }
  seedVendor(db,{vendorId:'v',name:'Vendor Test'});
  seedMenuVersion(db,{menuVersionId:'mv',vendor:'Vendor Test',effectiveDate:'2026-01-01'});
  db.run(`INSERT INTO menu_items(menu_item_id,menu_version_id,legacy_item_id,variant_key,item_name,price,enabled,source_order)
    VALUES ('mi','mv','SKU','BASE','Lunch',80,1,1)`);
  seedLedgerRow(db,{transactionId:'opening',userId:'member',amount:321,balanceAfter:321});
  addOrder(db, 'o1', 'member', '1F', 2);
  return db;
};
const addOrder = (db,id,user,floor,quantity) => {
  db.run(`INSERT INTO orders(order_id,user_id,display_name_snapshot,order_date,vendor,pickup_floor,note,total_amount,created_by_user_id)
    VALUES (?,?,?,?,'Vendor Test',?,'private phone 0999999999',?,?)`,id,user,'Private employee',DATE,floor,quantity*80,user);
  db.run(`INSERT INTO order_items(order_id,line_no,menu_item_id,legacy_item_id,item_name_snapshot,quantity,unit_price,subtotal)
    VALUES (?,1,'mi','SKU','Lunch',?,80,?)`,id,quantity,quantity*80);
};
const call = async (db,path,body,actor='admin',method=body?'POST':'GET',headers={},clock=NOW) => {
  const response = await handleFormalRequest(request('/api/vendor-orders'+path,{method,body,token:'local-fixture',headers}),{DB:db},
    {fetchImpl:profileFetch({token:'local-fixture',lineUserId:actor}),now:clock});
  return {status:response.status,...await response.json()};
};
const setup = async db => {
  const branch = await call(db,'/branches/b',{vendorId:'v',label:'Synthetic branch',policy:policy(),expectedRevision:0},'admin','PUT');
  assert.equal(branch.status,200,JSON.stringify(branch));
  const mapping = await call(db,'/branches/b/mappings',{menuItemId:'mi',variantKey:'BASE',serviceDate:DATE,externalSku:'external-lunch',options:['Regular'],externalUnitPrice:80,available:true,expectedRevision:0},'admin','PUT');
  assert.equal(mapping.status,200,JSON.stringify(mapping));
};
const prepare = (db,floors=['1F'],noteReviews=[]) => call(db,'/batches',{branchId:'b',serviceDate:DATE,floors,noteReviews});
const ready = async db => {
  await setup(db);
  const preview = await prepare(db);
  const batch = await prepare(db,['1F'],preview.snapshot.sourceNotes.map(n=>({sourceOrderId:n.sourceOrderId,sourceNoteHash:n.sourceNoteHash,reviewed:true,supplierNote:''})));
  assert.equal(batch.status,200,JSON.stringify(batch));
  const review = await call(db,'/batches/'+batch.batchId+'/review',{snapshotHash:batch.snapshotHash});
  assert.equal(review.status,200,JSON.stringify({review,warnings:batch.snapshot.warnings}));
  return batch;
};
const handoff = (db,batch,actor='admin',key='claim-one') => call(db,'/batches/'+batch.batchId+'/handoff',
  {snapshotHash:batch.snapshotHash,confirm:true,adapter:'MANUAL'},actor,'POST',{'Idempotency-Key':key});

test('vendor-order endpoints deny ordinary User and ungranted ProxyAdmin, including reads',async () => {
  const db=fixture();
  assert.equal((await call(db,'/access',null,'member')).status,403);
  await setup(db);
  assert.equal((await call(db,'/branches/b',null,'proxy')).status,403);
  assert.equal((await call(db,'/access?viewAsUserId=member')).status,403);
});
test('manual aggregation preserves original charges and exports no employee identity or raw note',async () => {
  const db=fixture(), batch=await ready(db);
  assert.equal(batch.snapshot.quantity,2);
  assert.equal(batch.snapshot.internalAmount,160);
  const before=JSON.stringify(db.database.prepare('SELECT * FROM balance_ledger').all());
  const result=await handoff(db,batch);
  assert.equal(result.status,200,JSON.stringify(result));
  assert.equal(result.state,'SUBMITTING');
  assert.equal(result.platformVerified,false);
  assert.equal(result.sheet.rows[0].externalSku,'external-lunch');
  assert.doesNotMatch(JSON.stringify(result.sheet),/Private employee|0999999999|employee-member|local-fixture/);
  assert.equal(JSON.stringify(db.database.prepare('SELECT * FROM balance_ledger').all()),before);
  assert.equal(db.get("SELECT balance FROM users WHERE user_id='member'").balance,321);
  assert.equal(db.get("SELECT status FROM orders WHERE order_id='o1'").status,'ACTIVE');
});
test('two actors racing handoff create one global attempt and permanent source-line claim',async () => {
  const db=fixture(), batch=await ready(db);
  const results=await Promise.all([handoff(db,batch),handoff(db,batch,'admin2','other-key')]);
  assert.equal(results.filter(x=>x.status===200&&!x.replayed).length,1);
  assert.equal(db.get('SELECT COUNT(*) n FROM vendor_order_attempts').n,1);
  assert.equal(db.get('SELECT COUNT(*) n FROM vendor_order_source_claims').n,1);
  assert.equal(db.get('SELECT COUNT(*) n FROM vendor_order_mutation_guards').n,0);
});
test('response loss retry replays handoff, UNKNOWN cannot release claims or resend',async () => {
  const db=fixture(),batch=await ready(db);
  const claimed=await handoff(db,batch);
  assert.equal((await handoff(db,batch)).replayed,true);
  const report=await call(db,'/batches/'+batch.batchId+'/report',{state:'UNKNOWN',expectedRevision:claimed.revision,externalReference:'manual-note',reportedAmount:160,paymentStatus:'UNCONFIRMED'});
  assert.equal(report.status,200,JSON.stringify(report));
  assert.equal(report.evidenceSource,'MANUAL_REPORTED');
  assert.equal(report.platformVerified,false);
  const replay=await handoff(db,batch);
  assert.equal(replay.state,'UNKNOWN');
  assert.equal(db.get('SELECT COUNT(*) n FROM vendor_order_attempts').n,1);
  assert.throws(()=>db.run('DELETE FROM vendor_order_source_claims'),/permanent/);
});
test('source membership change between read and batch rolls back claim, attempt, state and audit',async () => {
  const db=fixture(),batch=await ready(db),original=db.batch.bind(db);
  const auditBefore=db.get('SELECT COUNT(*) n FROM vendor_order_audit').n;
  let injected=false;
  db.batch=async statements=>{ if(!injected){injected=true;addOrder(db,'o2','member2','1F',1);} return original(statements); };
  const result=await handoff(db,batch);
  assert.equal(result.status,409,JSON.stringify(result));
  assert.equal(db.get('SELECT COUNT(*) n FROM vendor_order_attempts').n,0);
  assert.equal(db.get('SELECT COUNT(*) n FROM vendor_order_source_claims').n,0);
  assert.equal(db.get('SELECT COUNT(*) n FROM vendor_order_audit').n,auditBefore);
  assert.equal(db.get('SELECT state FROM vendor_order_batches').state,'READY');
});
test('overlapping floors and recreating scope cannot claim an already handed-off source line',async () => {
  const db=fixture(),batch=await ready(db);
  await handoff(db,batch);
  assert.equal((await prepare(db)).reconciliationRequired,true);
  const overlap=await prepare(db,['1F','2F']);
  assert.equal((await call(db,'/batches/'+overlap.batchId+'/review',{snapshotHash:overlap.snapshotHash})).status,409);
  assert.equal(db.get('SELECT COUNT(*) n FROM vendor_order_attempts').n,1);
});
for(const [label,change] of [
  ['cancellation',db=>db.run("UPDATE orders SET status='CANCELLED' WHERE order_id='o1'")],
  ['note',db=>db.run("UPDATE orders SET note='changed private detail' WHERE order_id='o1'")],
  ['menu availability',db=>db.run("UPDATE menu_items SET enabled=0 WHERE menu_item_id='mi'")],
  ['mapping',db=>db.run("UPDATE vendor_item_mappings SET external_unit_price=90")],
  ['mapping deletion',db=>db.run('DELETE FROM vendor_item_mappings')],
  ['policy',db=>db.run("UPDATE vendor_order_branches SET policy_json=json_set(policy_json,'$.address','changed office')")],
  ['actor revocation',db=>db.run("UPDATE users SET active=0 WHERE user_id='admin'")]
]) test('atomic handoff rejects concurrent '+label+' change with no partial claim',async()=>{
  const db=fixture(),batch=await ready(db),original=db.batch.bind(db);let injected=false;
  db.batch=async statements=>{if(!injected){injected=true;change(db);}return original(statements);};
  assert.equal((await handoff(db,batch)).status,409);
  assert.equal(db.get('SELECT COUNT(*) n FROM vendor_order_attempts').n,0);
  assert.equal(db.get('SELECT COUNT(*) n FROM vendor_order_source_claims').n,0);
  assert.equal(db.get('SELECT COUNT(*) n FROM vendor_order_mutation_guards').n,0);
});
test('explicit scoped ProxyAdmin grant works; concurrent revocation denies final claim',async()=>{
  const db=fixture(),batch=await ready(db);
  assert.equal((await call(db,'/branches/b/grants',{userId:'proxy',expiresAt:new Date(NOW.getTime()+86400000).toISOString(),revoked:false},'admin','PUT')).status,200);
  assert.equal((await call(db,'/branches/b',null,'proxy')).status,200);
  const original=db.batch.bind(db);let injected=false;
  db.batch=async statements=>{if(!injected){injected=true;db.run("UPDATE vendor_order_grants SET revoked=1");}return original(statements);};
  assert.equal((await handoff(db,batch,'proxy')).status,409);
  assert.equal(db.get('SELECT COUNT(*) n FROM vendor_order_attempts').n,0);
  assert.equal((await call(db,'/branches/b',null,'proxy')).status,403);
});
test('employee guest never inherits vendor capability, even from elevated canonical row',async()=>{
  const db=fixture();await setup(db);
  const guest=await createGuestSession(db,{userId:'member',employeeId:'employee-member',clock:NOW});
  const response=await handleFormalRequest(request('/api/vendor-orders/access',{token:guest.token}),{DB:db},{now:NOW,fetchImpl:()=>{throw new Error('No external lookup');}});
  assert.equal(response.status,403);
});
test('old source replacement, rejected report and alternate branch cannot bypass handed-off scope',async()=>{
  const db=fixture(),batch=await ready(db),claimed=await handoff(db,batch);
  db.run("UPDATE orders SET status='CANCELLED' WHERE order_id='o1'");addOrder(db,'replacement','member','1F',3);
  const newBatch=await prepare(db,['1F','2F']);
  assert.ok(newBatch.snapshot.warnings.includes('SCOPE_ALREADY_CLAIMED'));
  assert.equal((await call(db,'/batches/'+newBatch.batchId+'/review',{snapshotHash:newBatch.snapshotHash})).status,409);
  assert.equal((await call(db,'/batches/'+batch.batchId)).sourceChanged,true);
  const unknown=await call(db,'/batches/'+batch.batchId+'/report',{state:'UNKNOWN',expectedRevision:claimed.revision,reportedAmount:160,paymentStatus:'UNCONFIRMED'});
  assert.equal(unknown.sourceChanged,true);
  const rejected=await call(db,'/batches/'+batch.batchId+'/report',{state:'REJECTED',expectedRevision:unknown.revision,reportedAmount:160,paymentStatus:'UNPAID'});
  assert.equal(rejected.status,200);
  assert.equal(rejected.platformVerified,false);
  assert.equal((await handoff(db,batch)).replayed,true);
  assert.equal(db.get('SELECT COUNT(*) n FROM vendor_order_attempts').n,1);
});
test('cancelled source replaced by the same owner on another floor remains permanently reserved',async()=>{
  const db=fixture(),batch=await ready(db);await handoff(db,batch);
  db.run("UPDATE orders SET status='CANCELLED' WHERE order_id='o1'");
  addOrder(db,'moved-replacement','member','2F',2);
  const moved=await prepare(db,['2F']);
  assert.ok(moved.snapshot.warnings.includes('OWNER_ALREADY_CLAIMED'));
  assert.equal((await call(db,'/batches/'+moved.batchId+'/review',{snapshotHash:moved.snapshotHash})).status,409);
  assert.equal(db.get('SELECT COUNT(*) n FROM vendor_order_attempts').n,1);
});
for(const [code,key] of [['S','BASE'],['S','HALF'],['E','PLUS'],['A','PLUS']]) test('canonical Cai Teacher '+code+'/'+key+' is never collapsed into a legacy BASE mapping',async()=>{
  const db=fixture();
  db.run("UPDATE vendors SET name=? WHERE vendor_id='v'",HISTORICAL_SQL_VENDOR);
  db.run("UPDATE menu_versions SET vendor=? WHERE menu_version_id='mv'",HISTORICAL_SQL_VENDOR);
  db.run("UPDATE menu_items SET legacy_item_id=?,variant_key=? WHERE menu_item_id='mi'",code,key);
  db.run("UPDATE orders SET vendor=? WHERE order_id='o1'",HISTORICAL_SQL_VENDOR);
  const configured=await call(db,'/branches/b',{vendorId:'v',label:'Synthetic branch',policy:policy(),expectedRevision:0},'admin','PUT');
  assert.equal(configured.status,200);
  const mapping=await call(db,'/branches/b/mappings',{menuItemId:'mi',variantKey:key,serviceDate:DATE,externalSku:'EX-'+code+'-'+key,options:[],externalUnitPrice:80,available:true,expectedRevision:0},'admin','PUT');
  assert.equal(mapping.status,200,JSON.stringify(mapping));
  const preview=await prepare(db);
  const batch=await prepare(db,['1F'],preview.snapshot.sourceNotes.map(n=>({sourceOrderId:n.sourceOrderId,sourceNoteHash:n.sourceNoteHash,reviewed:true,supplierNote:''})));
  assert.equal(batch.snapshot.sourceItems[0].variantKey,key);
  assert.equal(batch.snapshot.rows[0].variantKey,key);
  assert.deepEqual(batch.snapshot.warnings,[]);
  assert.equal((await call(db,'/batches/'+batch.batchId+'/review',{snapshotHash:batch.snapshotHash})).status,200);
  const result=await handoff(db,batch);
  assert.equal(result.sheet.rows[0].variantKey,key);
});
test('unmapped, missing stable identity, price mismatch, unsupported address and minimum block review',async()=>{
  for(const [reason,warning] of [['unmapped','UNMAPPED'],['identity','IDENTITY_AMBIGUOUS'],['price','PRICE_DIFFERENCE'],['address','ADDRESS_UNSUPPORTED'],['minimum','MINIMUM_NOT_MET'],['holiday','SERVICE_UNAVAILABLE'],['stock','OUT_OF_STOCK']]){
    const db=fixture();await setup(db);
    const preview=await prepare(db);
    const noteReviews=preview.snapshot.sourceNotes.map(n=>({sourceOrderId:n.sourceOrderId,sourceNoteHash:n.sourceNoteHash,reviewed:true,supplierNote:''}));
    if(reason==='unmapped')db.run('DELETE FROM vendor_item_mappings');
    if(reason==='identity')db.run("UPDATE order_items SET menu_item_id=NULL WHERE order_id='o1'");
    if(reason==='price')db.run('UPDATE vendor_item_mappings SET external_unit_price=90');
    if(reason==='stock')db.run('UPDATE vendor_item_mappings SET available=0');
    if(reason==='address')db.run("UPDATE vendor_order_branches SET policy_json=json_set(policy_json,'$.addressConfirmed',json('false'))");
    if(reason==='minimum')db.run("UPDATE vendor_order_branches SET policy_json=json_set(policy_json,'$.minimumAmount',500)");
    if(reason==='holiday')db.run("UPDATE vendor_order_branches SET policy_json=json_set(policy_json,'$.closedDates',json(?))",JSON.stringify([DATE]));
    const batch=await prepare(db,['1F'],noteReviews);assert.ok(batch.snapshot.warnings.includes(warning),reason+': '+JSON.stringify(batch.snapshot.warnings));
    assert.ok(!batch.snapshot.warnings.includes('SOURCE_NOTES_REQUIRE_REVIEW'),reason);
    assert.equal((await call(db,'/batches/'+batch.batchId+'/review',{snapshotHash:batch.snapshotHash})).status,409,reason);
  }
});
test('Taipei internal/external windows, holidays and organizer shipping responsibility are explicit',()=>{
  const p=validatePolicy({...policy(),internalMode:'A',internalCutoff:'10:00',externalCutoff:'10:30'});
  assert.ok(policyWarnings(p,DATE,['1F'],160,new Date(DATE+'T09:59:00+08:00')).includes('COLLECTION_OPEN'));
  assert.ok(!policyWarnings(p,DATE,['1F'],160,new Date(DATE+'T10:15:00+08:00')).length);
  assert.ok(policyWarnings(p,DATE,['1F'],160,new Date(DATE+'T10:30:00+08:00')).includes('EXTERNAL_CUTOFF_PASSED'));
  assert.equal(policyWindow(p,DATE).externalClose,DATE+'T02:30:00.000Z');
  assert.throws(()=>validatePolicy({...policy(),paymentResponsibility:'CHARGE_EMPLOYEE_AGAIN'}));
});
test('extra confirmation and official adapter remain disabled regardless of env-like toggles',async()=>{
  const db=fixture(),batch=await ready(db);
  const bad=await call(db,'/batches/'+batch.batchId+'/handoff',{snapshotHash:batch.snapshotHash,confirm:false,adapter:'MANUAL'},'admin','POST',{'Idempotency-Key':'bad'});
  assert.equal(bad.status,400);
  const official=await call(db,'/batches/'+batch.batchId+'/handoff',{snapshotHash:batch.snapshotHash,confirm:true,adapter:'MAIFOOD_OFFICIAL_API',enabled:true},'admin','POST',{'Idempotency-Key':'official'});
  assert.equal(official.status,403);assert.equal(MAIFOOD_OFFICIAL_API.enabled,false);
  for(const method of ['prepare','validate','submit','status','reconcile'])assert.throws(()=>MAIFOOD_OFFICIAL_API[method]({MAIFOOD_ENABLED:true}),e=>e.code==='VENDOR_ORDER_ADAPTER_DISABLED');
  assert.equal(MANUAL.enabled,true);assert.equal(db.get('SELECT COUNT(*) n FROM vendor_order_attempts').n,0);
});
test('audit is append-only and mutation guards leave no residue after success or failure',async()=>{
  const db=fixture(),batch=await ready(db);await handoff(db,batch);
  assert.throws(()=>db.run('DELETE FROM vendor_order_audit'),/append-only/);
  assert.throws(()=>db.run("UPDATE vendor_order_audit SET action='tampered'"),/append-only/);
  assert.equal(db.get('SELECT COUNT(*) n FROM vendor_order_mutation_guards').n,0);
  assert.deepEqual(db.database.prepare('PRAGMA foreign_key_check').all(),[]);
});
test('same external SKU across menu versions with conflicting prices cannot produce an inconsistent handoff',async()=>{
  const db=fixture();await setup(db);
  seedMenuVersion(db,{menuVersionId:'new-mv',vendor:'Vendor Test',effectiveDate:DATE});
  db.run(`INSERT INTO menu_items(menu_item_id,menu_version_id,legacy_item_id,variant_key,item_name,price,enabled,source_order)
    VALUES ('new-mi','new-mv','SKU','BASE','Lunch',90,1,1)`);
  addOrder(db,'o2','member2','1F',1);
  db.run("UPDATE orders SET total_amount=90 WHERE order_id='o2'");
  db.run("UPDATE order_items SET menu_item_id='new-mi',unit_price=90,subtotal=90 WHERE order_id='o2'");
  assert.equal((await call(db,'/branches/b/mappings',{menuItemId:'new-mi',variantKey:'BASE',serviceDate:DATE,externalSku:'external-lunch',options:['Regular'],externalUnitPrice:90,available:true,expectedRevision:0},'admin','PUT')).status,200);
  const batch=await prepare(db);
  assert.ok(batch.snapshot.warnings.includes('EXTERNAL_PRICE_CONFLICT'));
  assert.ok(batch.snapshot.rows.every(r=>r.quantity*r.externalUnitPrice===r.subtotal));
  assert.equal((await call(db,'/batches/'+batch.batchId+'/review',{snapshotHash:batch.snapshotHash})).status,409);
});
test('different internal identities sharing one external SKU/options must share one confirmed price',async()=>{
  const db=fixture();await setup(db);
  db.run("INSERT INTO menu_items(menu_item_id,menu_version_id,legacy_item_id,variant_key,item_name,price,enabled,source_order) VALUES ('different-mi','mv','DIFFERENT','HALF','Other lunch',90,1,2)");
  addOrder(db,'other-order','member2','1F',1);
  db.run("UPDATE orders SET total_amount=90 WHERE order_id='other-order'");
  db.run("UPDATE order_items SET menu_item_id='different-mi',legacy_item_id='DIFFERENT',unit_price=90,subtotal=90 WHERE order_id='other-order'");
  assert.equal((await call(db,'/branches/b/mappings',{menuItemId:'different-mi',variantKey:'HALF',serviceDate:DATE,externalSku:'external-lunch',options:['Regular'],externalUnitPrice:90,available:true,expectedRevision:0},'admin','PUT')).status,200);
  const preview=await prepare(db),batch=await prepare(db,['1F'],preview.snapshot.sourceNotes.map(n=>({sourceOrderId:n.sourceOrderId,sourceNoteHash:n.sourceNoteHash,reviewed:true,supplierNote:''})));
  assert.ok(!batch.snapshot.warnings.includes('PRICE_DIFFERENCE'));
  assert.ok(batch.snapshot.warnings.includes('EXTERNAL_PRICE_CONFLICT'));
  assert.equal((await call(db,'/batches/'+batch.batchId+'/review',{snapshotHash:batch.snapshotHash})).status,409);
});
for(const domain of ['source','mapping'])test('frozen manual reconciliation remains available after '+domain+' exceeds preparation limits',async()=>{
  const db=fixture(),batch=await ready(db),claimed=await handoff(db,batch);
  if(domain==='source'){
    for(let i=0;i<201;i++){seedUser(db,{lineUserId:'late-user-'+i,role:'User'});addOrder(db,'late-order-'+i,'late-user-'+i,'1F',1);}
  }else{
    for(let i=0;i<301;i++){
      db.run("INSERT INTO menu_items(menu_item_id,menu_version_id,legacy_item_id,variant_key,item_name,price,enabled,source_order) VALUES (?,'mv',?,'BASE','Late',80,1,2)",'late-mi-'+i,'LATE-'+i);
      db.run("INSERT INTO vendor_item_mappings(mapping_id,branch_id,menu_item_id,variant_key,service_date,external_sku,options_json,external_unit_price,available,updated_by,updated_at) VALUES (?,'b',?,'BASE',?,?,'[]',80,1,'admin',?)",'late-mapping-'+i,'late-mi-'+i,DATE,'late-sku-'+i,NOW.toISOString());
    }
  }
  const detail=await call(db,'/batches/'+batch.batchId);
  assert.equal(detail.status,200,JSON.stringify(detail));assert.equal(detail.liveSnapshotError,'VENDOR_ORDER_SNAPSHOT_TOO_LARGE');
  assert.equal(detail.snapshotHash,batch.snapshotHash);assert.equal(detail.sourceChanged,domain==='source');
  assert.equal((await call(db,'/batches/'+batch.batchId+'/sheet')).status,200);
  const report=await call(db,'/batches/'+batch.batchId+'/report',{state:'UNKNOWN',expectedRevision:claimed.revision,reportedAmount:160,paymentStatus:'UNCONFIRMED'});
  assert.equal(report.status,200,JSON.stringify(report));assert.equal(report.sourceChanged,domain==='source');
  assert.equal(db.get('SELECT COUNT(*) n FROM vendor_order_attempts').n,1);
  assert.equal((await prepare(db,['1F','2F'])).status,409);
});
test('two overlapping scopes reviewed before either handoff cannot both claim',async()=>{
  const db=fixture(),first=await ready(db);
  const second=await prepare(db,['1F','2F'],first.snapshot.noteReviews);
  assert.equal((await call(db,'/batches/'+second.batchId+'/review',{snapshotHash:second.snapshotHash})).status,200);
  const results=await Promise.all([handoff(db,first),handoff(db,second,'admin2','scope-two')]);
  assert.equal(results.filter(r=>r.status===200).length,1);
  assert.equal(db.get('SELECT COUNT(*) n FROM vendor_order_attempts').n,1);
});
test('claim response loss after commit recovers via read-only sheet without creating another attempt',async()=>{
  const db=fixture(),batch=await ready(db),original=db.batch.bind(db);let lost=false;
  db.batch=async statements=>{const result=await original(statements);if(!lost){lost=true;throw new Error('Synthetic response lost');}return result;};
  assert.equal((await handoff(db,batch)).status,409);
  const recovered=await call(db,'/batches/'+batch.batchId+'/sheet');
  assert.equal(recovered.status,200);assert.equal(recovered.replayed,true);
  assert.equal(db.get('SELECT COUNT(*) n FROM vendor_order_attempts').n,1);
  assert.equal((await handoff(db,batch)).replayed,true);
  assert.equal((await call(db,'/batches/'+batch.batchId+'/sheet',null,'member')).status,403);
});
test('own permanent reservation does not falsely mark an unchanged batch as source/config drift',async()=>{
  const db=fixture(),batch=await ready(db);await handoff(db,batch);
  const unchanged=await call(db,'/batches/'+batch.batchId);
  assert.equal(unchanged.sourceChanged,false);assert.equal(unchanged.snapshotChanged,false);
  db.run('UPDATE vendor_item_mappings SET external_unit_price=90');
  const changed=await call(db,'/batches/'+batch.batchId);
  assert.equal(changed.sourceChanged,false);assert.equal(changed.snapshotChanged,true);
});
test('report source drift race rolls back report and preserves previous external reference audit',async()=>{
  const db=fixture(),batch=await ready(db),claimed=await handoff(db,batch);
  const submitted=await call(db,'/batches/'+batch.batchId+'/report',{state:'SUBMITTED',expectedRevision:claimed.revision,externalReference:'reference-first',reportedAmount:160,paymentStatus:'UNPAID'});
  assert.equal(submitted.status,200);
  const original=db.batch.bind(db);let changed=false;
  db.batch=async statements=>{if(!changed){changed=true;db.run("UPDATE orders SET note='new instruction' WHERE order_id='o1'");}return original(statements);};
  const body={state:'ACCEPTED',expectedRevision:submitted.revision,externalReference:'reference-second',reportedAmount:160,paymentStatus:'PAID'};
  assert.equal((await call(db,'/batches/'+batch.batchId+'/report',body)).status,409);
  assert.equal(db.get('SELECT state FROM vendor_order_batches').state,'SUBMITTED');
  assert.equal((await call(db,'/batches/'+batch.batchId+'/report',body)).sourceChanged,true);
  const detail=await call(db,'/batches/'+batch.batchId);
  const refs=detail.audit.filter(a=>a.action==='MANUAL_REPORTED').map(a=>JSON.parse(a.metadataJson).externalReference);
  assert.deepEqual(new Set(refs),new Set(['reference-first','reference-second']));
});
test('source notes require explicit hash-bound review; only supplier-approved text leaves the review view',async()=>{
  const db=fixture();await setup(db);
  const preview=await prepare(db);assert.ok(preview.snapshot.warnings.includes('SOURCE_NOTES_REQUIRE_REVIEW'));
  assert.equal((await call(db,'/batches/'+preview.batchId+'/review',{snapshotHash:preview.snapshotHash})).status,409);
  const notes=preview.snapshot.sourceNotes.map(n=>({sourceOrderId:n.sourceOrderId,sourceNoteHash:n.sourceNoteHash,reviewed:true,supplierNote:'No chili'}));
  const approved=await prepare(db,['1F'],notes);
  assert.equal((await call(db,'/batches/'+approved.batchId+'/review',{snapshotHash:approved.snapshotHash})).status,200);
  const result=await handoff(db,approved);
  assert.equal(result.sheet.rows[0].supplierNote,'No chili');
  assert.doesNotMatch(JSON.stringify(result.sheet),/0999999999|private phone/);
});
test('the transaction uses real SQL time, even when an injected preview clock is before an expired cutoff',async()=>{
  const db=fixture();await setup(db);
  const pastDate=getTaipeiDate(new Date(NOW.getTime()-86400000)),clock=new Date(pastDate+'T10:15:00+08:00');
  const p={...policy(),serviceDates:[pastDate]};
  db.run('UPDATE vendor_order_branches SET policy_json=?',JSON.stringify(p));
  db.run('UPDATE orders SET order_date=?',pastDate);db.run('UPDATE vendor_item_mappings SET service_date=?',pastDate);
  const body={branchId:'b',serviceDate:pastDate,floors:['1F']};
  const first=await call(db,'/batches',body,'admin','POST',{},clock);
  const notes=first.snapshot.sourceNotes.map(n=>({sourceOrderId:n.sourceOrderId,sourceNoteHash:n.sourceNoteHash,reviewed:true,supplierNote:''}));
  const batch=await call(db,'/batches',{...body,noteReviews:notes},'admin','POST',{},clock);
  assert.equal((await call(db,'/batches/'+batch.batchId+'/review',{snapshotHash:batch.snapshotHash},'admin','POST',{},clock)).status,200);
  const result=await call(db,'/batches/'+batch.batchId+'/handoff',{snapshotHash:batch.snapshotHash,confirm:true,adapter:'MANUAL'},'admin','POST',{'Idempotency-Key':'expired'},clock);
  assert.equal(result.status,409);assert.equal(db.get('SELECT COUNT(*) n FROM vendor_order_attempts').n,0);
});

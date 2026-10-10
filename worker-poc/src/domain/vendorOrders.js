import { ACTIONS, assertCan } from '../auth/permissions.js';
import { canonicalJson, hashRequest, requireIdempotencyKey } from '../db/idempotency.js';
import { prepareStatement, randomId, runMutationBatch } from '../db/transactions.js';
import { badRequest, conflict, forbidden, notFound } from '../http/errors.js';
import { getCustomerMenu } from './menu.js';
import { normalizeLegacyMenuIdentity } from './menuItemChanges.js';
import { compatibilityVendorCandidates, normalizeMenuVendor, HISTORICAL_SQL_VENDOR, CANONICAL_HE_SHI_VENDOR } from './menuVendors.js';
import { boundedText, dateOnly, integer, policyWarnings, policyWindow, stringList, validatePolicy } from './vendorOrderPolicy.js';

const statement=(db,sql,params=[])=>prepareStatement(db,sql,params);
const rows=async(db,sql,params=[]) => (await statement(db,sql,params).all()).results;
const LIVE_ACTOR=`EXISTS (SELECT 1 FROM users u WHERE u.user_id=? AND u.line_user_id=? AND u.employee_id=?
  AND u.active=1 AND u.verification_status='VERIFIED' AND
  (u.role='Admin' OR (?=0 AND u.role='ProxyAdmin' AND EXISTS
    (SELECT 1 FROM vendor_order_grants g WHERE g.user_id=u.user_id AND g.branch_id=? AND g.revoked=0 AND julianday(g.expires_at)>julianday('now')))))`;
const authParams=(identity,branchId,adminOnly=false)=>[identity.actor.userId,identity.actor.lineUserId,identity.actor.employeeId,adminOnly?1:0,branchId];
export const authorizeVendorOrders=async(db,identity,branchId=null,adminOnly=false)=>{
  const actor=identity?.actor;
  if (!actor?.registered || actor.authMode!=='line' || identity.viewAs || !['Admin','ProxyAdmin'].includes(actor.role)) throw forbidden('VENDOR_ORDER_FORBIDDEN');
  if (adminOnly) assertCan(identity,ACTIONS.ADMIN_VENDOR_ORDERS);
  const live=await statement(db,`SELECT ${LIVE_ACTOR} AS ok`,authParams(identity,branchId,adminOnly)).first();
  if (!live.ok) throw forbidden('VENDOR_ORDER_FORBIDDEN');
};
const audit=(db,identity,branchId,batchId,action,hash,now,metadata={})=>statement(db,
  `INSERT INTO vendor_order_audit(audit_id,branch_id,batch_id,actor_user_id,action,snapshot_hash,metadata_json,occurred_at) VALUES (?,?,?,?,?,?,?,?)`,
  [randomId('VOA'),branchId,batchId,identity.actor.userId,action,hash,canonicalJson(metadata),now.toISOString()]);
// CHECK aborts the whole D1 transaction before a claim, sheet or audit can escape.
const atomic=async(db,identity,branchId,sql,params,writes,{adminOnly=false}={})=>{
  const guard=randomId('VOG');
  try {
    await runMutationBatch(db,[statement(db,`INSERT INTO vendor_order_mutation_guards(guard_id,ok) SELECT ?, (${LIVE_ACTOR}) AND (${sql})`,
      [guard,...authParams(identity,branchId,adminOnly),...params]),...writes,
      statement(db,'DELETE FROM vendor_order_mutation_guards WHERE guard_id=?',[guard])]);
  } catch(error) {
    // Do not leak SQL, identity, source notes or credentials through the response.
    if (error.code==='TRANSACTION_FAILED') throw conflict('VENDOR_ORDER_CONFLICT','Refresh and reconcile before retrying.');
    throw error;
  }
};
const branch=async(db,id)=>{
  const row=await statement(db,`SELECT b.*,v.name AS vendor,v.enabled AS vendor_enabled FROM vendor_order_branches b JOIN vendors v USING(vendor_id) WHERE branch_id=?`,[id]).first();
  if(!row) throw notFound('VENDOR_ORDER_BRANCH_NOT_FOUND');
  return {...row,policy:JSON.parse(row.policy_json)};
};
export const vendorOrderAccess=async(db,identity)=>{
  const actor=identity.actor;
  if(actor.authMode!=='line'||!actor.registered||!['Admin','ProxyAdmin'].includes(actor.role)||identity.viewAs) throw forbidden('VENDOR_ORDER_FORBIDDEN');
  const ids=await rows(db,`SELECT branch_id FROM vendor_order_branches ORDER BY branch_id`);
  const branches=[];
  if(actor.role==='Admin') await authorizeVendorOrders(db,identity,null,true);
  for(const {branch_id} of ids) {
    try {await authorizeVendorOrders(db,identity,branch_id);branches.push(await getVendorBranch(db,identity,branch_id));}
    catch(error){if(error.status!==403)throw error;}
  }
  return {capability:'ADMIN_VENDOR_ORDERS',canConfigure:actor.role==='Admin',branches,adapter:'MANUAL',officialApiEnabled:false};
};
export const getVendorBranch=async(db,identity,id)=>{
  await authorizeVendorOrders(db,identity,id);
  const b=await branch(db,id);
  return {branchId:id,vendorId:b.vendor_id,vendor:b.vendor,label:b.label,policy:b.policy,revision:b.revision,
    mappings:await rows(db,`SELECT mapping_id AS mappingId,menu_item_id AS menuItemId,variant_key AS variantKey,service_date AS serviceDate,
      external_sku AS externalSku,options_json AS optionsJson,external_unit_price AS externalUnitPrice,available,revision FROM vendor_item_mappings WHERE branch_id=? ORDER BY service_date,menu_item_id,variant_key`,[id])};
};
export const configureVendorBranch=async(db,identity,id,input,now)=>{
  await authorizeVendorOrders(db,identity,id,true);
  boundedText(id);const policy=validatePolicy(input.policy),revision=integer(input.expectedRevision),vendorId=boundedText(input.vendorId),label=boundedText(input.label);
  const vendor=await statement(db,'SELECT * FROM vendors WHERE vendor_id=? AND enabled=1',[vendorId]).first();
  if(!vendor)throw badRequest('VENDOR_ORDER_VENDOR_INVALID');
  const existing=await statement(db,'SELECT * FROM vendor_order_branches WHERE branch_id=?',[id]).first();
  if(existing&&existing.vendor_id!==vendorId)throw conflict('VENDOR_ORDER_VENDOR_IMMUTABLE');
  const sql=existing?'EXISTS(SELECT 1 FROM vendor_order_branches WHERE branch_id=? AND revision=?)':'NOT EXISTS(SELECT 1 FROM vendor_order_branches WHERE branch_id=?) AND ?=0';
  await atomic(db,identity,id,sql+' AND EXISTS(SELECT 1 FROM vendors WHERE vendor_id=? AND enabled=1)',[id,revision,vendorId],[statement(db,
    `INSERT INTO vendor_order_branches(branch_id,vendor_id,label,policy_json,updated_by,updated_at) VALUES (?,?,?,?,?,?)
    ON CONFLICT(branch_id) DO UPDATE SET label=excluded.label,policy_json=excluded.policy_json,revision=revision+1,updated_by=excluded.updated_by,updated_at=excluded.updated_at`,
    [id,vendorId,label,canonicalJson(policy),identity.actor.userId,now.toISOString()]),audit(db,identity,id,null,'BRANCH_CONFIGURED',null,now)],{adminOnly:true});
  return getVendorBranch(db,identity,id);
};
const variant=(vendor,item)=>{
  const code=String(item.legacy_item_id||'').trim(),key=String(item.variant_key||'').trim();
  if(['BASE','HALF','PLUS'].includes(key)){
    // Modern explicit variants take precedence over legacy code aliases.
    if(vendor===HISTORICAL_SQL_VENDOR&&!['S','C','CM','E','A','AM','B','FR'].includes(code))return null;
    if(vendor===CANONICAL_HE_SHI_VENDOR&&!/^H[1-5]$/.test(code))return null;
    return code?{item_code:code,variant_key:key}:null;
  }
  if(key)return null;
  return normalizeLegacyMenuIdentity({vendor,itemCode:code,variantKey:'',itemName:''});
};
export const configureVendorMapping=async(db,identity,id,input,now)=>{
  await authorizeVendorOrders(db,identity,id,true);
  const b=await branch(db,id),menuId=boundedText(input.menuItemId),date=dateOnly(input.serviceDate),key=boundedText(input.variantKey),revision=integer(input.expectedRevision);
  const item=await statement(db,'SELECT mi.*,mv.vendor,mv.effective_date FROM menu_items mi JOIN menu_versions mv USING(menu_version_id) WHERE menu_item_id=?',[menuId]).first();
  const canonical=item&&variant(normalizeMenuVendor(b.vendor),item);
  if(!item||normalizeMenuVendor(item.vendor)!==normalizeMenuVendor(b.vendor)||!canonical||canonical.variant_key!==key||item.effective_date>date)throw badRequest('VENDOR_ORDER_IDENTITY_AMBIGUOUS');
  if(typeof input.available!=='boolean')throw badRequest('VENDOR_ORDER_MAPPING_INVALID');
  const options=stringList(input.options),sku=boundedText(input.externalSku),price=integer(input.externalUnitPrice);
  const existing=await statement(db,'SELECT * FROM vendor_item_mappings WHERE branch_id=? AND menu_item_id=? AND variant_key=? AND service_date=?',[id,menuId,key,date]).first();
  const condition=existing?'EXISTS(SELECT 1 FROM vendor_item_mappings WHERE mapping_id=? AND revision=?)':'NOT EXISTS(SELECT 1 FROM vendor_item_mappings WHERE mapping_id=?) AND ?=0';
  const mappingId=existing?.mapping_id||randomId('VOM');
  await atomic(db,identity,id,condition+` AND EXISTS(SELECT 1 FROM vendor_order_branches WHERE branch_id=? AND revision=?)
    AND EXISTS(SELECT 1 FROM menu_items m JOIN menu_versions v USING(menu_version_id) WHERE m.menu_item_id=? AND m.legacy_item_id=? AND m.variant_key=? AND v.vendor=? AND v.effective_date<=?)`,
    [mappingId,revision,id,b.revision,menuId,item.legacy_item_id,item.variant_key,item.vendor,date],[statement(db,
    `INSERT INTO vendor_item_mappings(mapping_id,branch_id,menu_item_id,variant_key,service_date,external_sku,options_json,external_unit_price,available,updated_by,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(branch_id,menu_item_id,variant_key,service_date) DO UPDATE SET external_sku=excluded.external_sku,
    options_json=excluded.options_json,external_unit_price=excluded.external_unit_price,available=excluded.available,revision=revision+1,updated_by=excluded.updated_by,updated_at=excluded.updated_at`,
    [mappingId,id,menuId,key,date,sku,canonicalJson(options),price,input.available?1:0,identity.actor.userId,now.toISOString()]),audit(db,identity,id,null,'MAPPING_CONFIGURED',null,now)],{adminOnly:true});
  return getVendorBranch(db,identity,id);
};
export const configureVendorGrant=async(db,identity,id,input,now)=>{
  await authorizeVendorOrders(db,identity,id,true);await branch(db,id);
  const userId=boundedText(input.userId),expires=new Date(input.expiresAt);
  if(!Number.isFinite(expires.getTime())||expires<=now||typeof input.revoked!=='boolean')throw badRequest('VENDOR_ORDER_GRANT_INVALID');
  const target=await statement(db,"SELECT * FROM users WHERE user_id=? AND role='ProxyAdmin' AND active=1 AND verification_status='VERIFIED' AND line_user_id IS NOT NULL AND employee_id IS NOT NULL",[userId]).first();
  if(!target)throw badRequest('VENDOR_ORDER_GRANT_TARGET_INVALID');
  await atomic(db,identity,id,"EXISTS(SELECT 1 FROM users WHERE user_id=? AND role='ProxyAdmin' AND active=1 AND verification_status='VERIFIED' AND line_user_id IS NOT NULL AND employee_id IS NOT NULL)",[userId],[statement(db,
    `INSERT INTO vendor_order_grants(branch_id,user_id,expires_at,revoked,granted_by) VALUES (?,?,?,?,?) ON CONFLICT(branch_id,user_id)
      DO UPDATE SET expires_at=excluded.expires_at,revoked=excluded.revoked,granted_by=excluded.granted_by`,
    [id,userId,expires.toISOString(),input.revoked?1:0,identity.actor.userId]),audit(db,identity,id,null,'GRANT_CONFIGURED',null,now,{userId,revoked:input.revoked})],{adminOnly:true});
  return {success:true};
};

// Sorted SQL fingerprints are reread inside the mutation's first statement.
// Include whole membership, empty orders, raw-note changes (internal only),
// canonical ownership, prices and stable item identities, not just old row IDs.
const SOURCE_SQL=`SELECT COALESCE(json_group_array(json(row)),'[]') FROM (
 SELECT json_object('orderId',o.order_id,'owner',o.user_id,'date',o.order_date,'vendor',o.vendor,'floor',o.pickup_floor,
 'status',o.status,'updated',o.updated_at,'note',o.note,'total',o.total_amount,'line',i.line_no,'menuId',i.menu_item_id,
 'legacy',i.legacy_item_id,'name',i.item_name_snapshot,'quantity',i.quantity,'unitPrice',i.unit_price,'subtotal',i.subtotal,
 'menuLegacy',m.legacy_item_id,'variant',m.variant_key,'menuVendor',mv.vendor,'menuDate',mv.effective_date) row
 FROM orders o LEFT JOIN order_items i USING(order_id) LEFT JOIN menu_items m ON m.menu_item_id=i.menu_item_id
 LEFT JOIN menu_versions mv ON mv.menu_version_id=m.menu_version_id
 WHERE o.status='ACTIVE' AND o.vendor IN (SELECT value FROM json_each(?)) AND o.order_date=? AND o.pickup_floor IN (SELECT value FROM json_each(?))
 ORDER BY o.order_id,i.line_no)`;
const MAPPINGS_SQL=`SELECT COALESCE(json_group_array(json(row)),'[]') FROM (SELECT json_object('id',mapping_id,'menuId',menu_item_id,
 'variant',variant_key,'date',service_date,'sku',external_sku,'options',options_json,'price',external_unit_price,'available',available,'revision',revision) row
 FROM vendor_item_mappings WHERE branch_id=? AND service_date=? ORDER BY menu_item_id,variant_key)`;
const MENU_SQL=`SELECT json_object('versions',(SELECT json_group_array(json(row)) FROM (SELECT json_object('id',v.menu_version_id,'date',v.effective_date,'vendor',v.vendor,'batch',v.source_batch_id,'importer',ib.importer_version) row
 FROM menu_versions v LEFT JOIN import_batches ib ON ib.batch_id=v.source_batch_id WHERE v.vendor IN (SELECT value FROM json_each(?)) AND v.effective_date<=? ORDER BY v.menu_version_id)),
 'items',(SELECT json_group_array(json(row)) FROM (SELECT json_object('id',m.menu_item_id,'code',m.legacy_item_id,'variant',m.variant_key,'name',m.item_name,'price',m.price,'enabled',m.enabled,'version',m.menu_version_id,'note',m.note,'order',m.source_order) row
 FROM menu_items m JOIN menu_versions v USING(menu_version_id) WHERE v.vendor IN (SELECT value FROM json_each(?)) AND v.effective_date<=? ORDER BY m.menu_item_id)),
 'changes',(SELECT json_group_array(json(row)) FROM (SELECT json_object('id',c.menu_item_change_id,'seq',s.sequence_number,'date',c.effective_date,'vendor',c.vendor,'code',c.item_code,'variant',c.variant_key,'price',c.price,'enabled',c.enabled,'name',c.item_name,'schema',c.identity_schema_version,'kind',c.source_kind,'note',c.note,'order',c.display_order) row
 FROM menu_item_changes c LEFT JOIN menu_item_change_sequence s USING(menu_item_change_id) WHERE c.vendor IN (SELECT value FROM json_each(?)) AND c.effective_date<=? ORDER BY c.menu_item_change_id)))`;
const claimsSql=`SELECT COALESCE(json_group_array(json(row)),'[]') FROM (SELECT json_object('orderId',c.source_order_id,'line',c.source_line_no,'attempt',c.attempt_id) row
 FROM vendor_order_source_claims c JOIN orders o ON o.order_id=c.source_order_id WHERE o.status='ACTIVE' AND o.vendor IN (SELECT value FROM json_each(?))
 AND o.order_date=? AND o.pickup_floor IN (SELECT value FROM json_each(?)) ORDER BY c.source_order_id,c.source_line_no)`;
// Also reserve the logical vendor/date/floor scope permanently. Replacing a
// source order creates new IDs; that must not bypass an earlier handoff.
const scopesSql=`SELECT COALESCE(json_group_array(json(row)),'[]') FROM (SELECT json_object('batch',b.batch_id,'attempt',a.attempt_id,'floor',f.value) row
 FROM vendor_order_batches b JOIN vendor_order_attempts a USING(batch_id) JOIN vendor_order_branches vb ON vb.branch_id=b.branch_id
 JOIN vendors v ON v.vendor_id=vb.vendor_id JOIN json_each(b.floors_json) f
 WHERE v.name IN (SELECT value FROM json_each(?)) AND b.service_date=? AND f.value IN (SELECT value FROM json_each(?)) ORDER BY b.batch_id,f.value)`;
const ownersSql=`SELECT COALESCE(json_group_array(json(row)),'[]') FROM (SELECT DISTINCT json_object('owner',c.owner_user_id,'attempt',c.attempt_id) row
 FROM vendor_order_owner_claims c JOIN orders o ON o.user_id=c.owner_user_id AND o.order_date=c.service_date
 WHERE c.vendor IN (SELECT value FROM json_each(?)) AND c.service_date=? AND o.status='ACTIVE'
 AND o.pickup_floor IN (SELECT value FROM json_each(?)) AND o.vendor IN (SELECT value FROM json_each(?)) ORDER BY c.owner_user_id,c.attempt_id)`;
export const createVendorSnapshot=async(db,b,date,floors,now,noteReviews=[])=>{
  const vendorList=canonicalJson(compatibilityVendorCandidates(b.vendor)),sourceParams=[vendorList,date,canonicalJson(floors)],ownerParams=[...sourceParams,vendorList],mapParams=[b.branch_id,date],menuParams=[vendorList,date,vendorList,date,vendorList,date];
  const values=await statement(db,`SELECT (${SOURCE_SQL}) source,(${MAPPINGS_SQL}) mappings,(${MENU_SQL}) menu,(${claimsSql}) claims,(${scopesSql}) scopes,(${ownersSql}) owners`,[...sourceParams,...mapParams,...menuParams,...sourceParams,...sourceParams,...ownerParams]).first();
  const sources=JSON.parse(values.source),mappings=JSON.parse(values.mappings),menu=await getCustomerMenu(db,{vendor:b.vendor,targetDate:date,preserveExplicitVariants:true});
  if(sources.length>200||mappings.length>300)throw conflict('VENDOR_ORDER_SNAPSHOT_TOO_LARGE');
  if(!Array.isArray(noteReviews)||noteReviews.length>200)throw badRequest('VENDOR_ORDER_NOTES_INVALID');
  const sourceNotes=[];
  for(const [sourceOrderId,note] of new Map(sources.filter(r=>String(r.note).trim()).map(r=>[r.orderId,r.note])))
    sourceNotes.push({sourceOrderId,note,sourceNoteHash:await hashRequest({sourceOrderId,note})});
  const reviewedNotes=noteReviews.map(r=>{
    if(r.reviewed!==true)throw badRequest('VENDOR_ORDER_NOTES_INVALID');
    return {sourceOrderId:boundedText(r.sourceOrderId),sourceNoteHash:boundedText(r.sourceNoteHash),reviewed:true,supplierNote:r.supplierNote?boundedText(r.supplierNote,500):''};
  });
  if(new Set(reviewedNotes.map(r=>r.sourceOrderId)).size!==reviewedNotes.length)throw badRequest('VENDOR_ORDER_NOTES_INVALID');
  const warnings=[],sourceItems=[],grouped=new Map(),externalPrices=new Map();let internalAmount=0,externalItemsAmount=0,quantity=0;
  const orderTotals=new Map();
  if(sourceNotes.some(n=>!reviewedNotes.some(r=>r.sourceOrderId===n.sourceOrderId&&r.sourceNoteHash===n.sourceNoteHash)))warnings.push('SOURCE_NOTES_REQUIRE_REVIEW');
  for(const row of sources){
    if(!row.line){warnings.push('EMPTY_ORDER');continue;}
    const canonical=variant(normalizeMenuVendor(b.vendor),{legacy_item_id:row.menuLegacy,variant_key:row.variant});
    const validIdentity=row.menuId&&canonical&&normalizeMenuVendor(row.menuVendor)===normalizeMenuVendor(b.vendor)&&row.menuDate<=date;
    const mapping=validIdentity&&mappings.find(m=>m.menuId===row.menuId&&m.variant===canonical.variant_key);
    const currentMatches=validIdentity?menu.filter(m=>{
      const key=variant(normalizeMenuVendor(b.vendor),m);
      return key?.item_code===canonical.item_code&&key.variant_key===canonical.variant_key;
    }):[];
    const current=currentMatches.length===1?currentMatches[0]:null;
    if(!validIdentity)warnings.push('IDENTITY_AMBIGUOUS');
    if(!mapping)warnings.push('UNMAPPED');
    if(!current||!mapping?.available)warnings.push('OUT_OF_STOCK');
    if(!Number.isSafeInteger(row.quantity)||row.quantity<=0||!Number.isSafeInteger(row.unitPrice)||!Number.isSafeInteger(row.subtotal)||row.unitPrice<0||row.subtotal!==row.unitPrice*row.quantity)warnings.push('SOURCE_AMOUNT_INVALID');
    if(mapping&&mapping.price!==row.unitPrice)warnings.push('PRICE_DIFFERENCE');
    orderTotals.set(row.orderId,(orderTotals.get(row.orderId)||0)+row.subtotal);
    internalAmount+=row.subtotal;quantity+=row.quantity;
    if(mapping)externalItemsAmount+=mapping.price*row.quantity;
    const reviewed=reviewedNotes.find(r=>r.sourceOrderId===row.orderId&&sourceNotes.some(n=>n.sourceOrderId===r.sourceOrderId&&n.sourceNoteHash===r.sourceNoteHash));
    const item={sourceOrderId:row.orderId,ownerUserId:row.owner,lineNo:row.line,menuItemId:row.menuId,variantKey:canonical?.variant_key||null,itemCode:canonical?.item_code||null,
      floor:row.floor,quantity:row.quantity,unitPrice:row.unitPrice,subtotal:row.subtotal,externalSku:mapping?.sku||null,options:mapping?JSON.parse(mapping.options):[],externalUnitPrice:mapping?.price??null};
    sourceItems.push(item);
    if(mapping){
      // The merchant sells by external SKU/options; internal aliases cannot
      // create a second price for that same external sales identity.
      const priceKey=canonicalJson([mapping.sku,mapping.options]);
      if(externalPrices.has(priceKey)&&externalPrices.get(priceKey)!==mapping.price)warnings.push('EXTERNAL_PRICE_CONFLICT');
      externalPrices.set(priceKey,mapping.price);
      const supplierNote=reviewed?.supplierNote||'';
      const key=canonicalJson([row.floor,canonical.item_code,canonical.variant_key,mapping.sku,mapping.options,mapping.price,supplierNote]);
      const group=grouped.get(key)||{floor:row.floor,itemCode:canonical.item_code,variantKey:canonical.variant_key,externalSku:mapping.sku,options:JSON.parse(mapping.options),supplierNote,externalUnitPrice:mapping.price,quantity:0,subtotal:0};
      group.quantity+=row.quantity;group.subtotal+=row.quantity*mapping.price;grouped.set(key,group);}
  }
  for(const row of sources)if(orderTotals.get(row.orderId)!==row.total)warnings.push('SOURCE_TOTAL_INVALID');
  if(!sourceItems.length)warnings.push('EMPTY');
  if(!b.vendor_enabled)warnings.push('VENDOR_DISABLED');
  if(JSON.parse(values.claims).length)warnings.push('SOURCE_ALREADY_CLAIMED');
  if(JSON.parse(values.scopes).length)warnings.push('SCOPE_ALREADY_CLAIMED');
  if(JSON.parse(values.owners).length)warnings.push('OWNER_ALREADY_CLAIMED');
  const shippingFee=externalItemsAmount>=b.policy.freeShippingThreshold?0:b.policy.shippingFee;
  const externalAmount=externalItemsAmount+shippingFee;
  if(![internalAmount,externalItemsAmount,quantity,externalAmount].every(Number.isSafeInteger))warnings.push('SOURCE_AMOUNT_INVALID');
  warnings.push(...policyWarnings(b.policy,date,floors,externalItemsAmount,now));
  const snapshot={branchId:b.branch_id,vendor:b.vendor,branchLabel:b.label,serviceDate:date,address:b.policy.address,floors,policy:b.policy,
    branchRevision:b.revision,sourceItems,sourceNotes,noteReviews:reviewedNotes,rows:[...grouped.values()],quantity,internalAmount,externalItemsAmount,shippingFee,externalAmount,
    amountDifference:externalAmount-internalAmount,warnings:[...new Set(warnings)].sort(),window:policyWindow(b.policy,date),
    guard:values};
  return {snapshot,snapshotHash:await hashRequest(snapshot),sourceParams,ownerParams,mapParams,menuParams};
};
const publicSnapshot=({guard:_guard,...snapshot})=>snapshot;
const publicBatch=row=>({batchId:row.batch_id,branchId:row.branch_id,serviceDate:row.service_date,state:row.state,revision:row.revision,snapshotHash:row.snapshot_hash,snapshot:publicSnapshot(JSON.parse(row.snapshot_json))});
const loadBatch=async(db,identity,id)=>{
  const row=await statement(db,'SELECT * FROM vendor_order_batches WHERE batch_id=?',[id]).first();
  if(!row)throw notFound('VENDOR_ORDER_BATCH_NOT_FOUND');
  await authorizeVendorOrders(db,identity,row.branch_id);return row;
};
const snapshotPredicate=(b,context)=>({
  sql:`EXISTS(SELECT 1 FROM vendor_order_branches b JOIN vendors v USING(vendor_id) WHERE b.branch_id=? AND b.revision=? AND b.policy_json=? AND v.name=? AND v.enabled=1)
    AND (${SOURCE_SQL})=? AND (${MAPPINGS_SQL})=? AND (${MENU_SQL})=? AND (${claimsSql})=? AND (${scopesSql})=? AND (${ownersSql})=?`,
  params:[b.branch_id,b.revision,b.policy_json,b.vendor,...context.sourceParams,context.snapshot.guard.source,...context.mapParams,context.snapshot.guard.mappings,
    ...context.menuParams,context.snapshot.guard.menu,...context.sourceParams,context.snapshot.guard.claims,...context.sourceParams,context.snapshot.guard.scopes,...context.ownerParams,context.snapshot.guard.owners]
});
export const prepareVendorBatch=async(db,identity,input,now)=>{
  const id=boundedText(input.branchId),date=dateOnly(input.serviceDate),floors=stringList(input.floors);
  if(!floors.length)throw badRequest('VENDOR_ORDER_FLOORS_REQUIRED');
  await authorizeVendorOrders(db,identity,id);const b=await branch(db,id),context=await createVendorSnapshot(db,b,date,floors,now,input.noteReviews||[]);
  const scopeKey=await hashRequest({branchId:id,date,floors,address:b.policy.address});
  const existing=await statement(db,'SELECT * FROM vendor_order_batches WHERE scope_key=?',[scopeKey]).first();
  if(existing&&!['DRAFT','READY'].includes(existing.state))return {...publicBatch(existing),reconciliationRequired:true,currentSnapshot:publicSnapshot(context.snapshot)};
  const batchId=existing?.batch_id||randomId('VOB'),predicate=snapshotPredicate(b,context);
  const stateGuard=existing?"EXISTS(SELECT 1 FROM vendor_order_batches WHERE batch_id=? AND revision=? AND state IN ('DRAFT','READY'))":"NOT EXISTS(SELECT 1 FROM vendor_order_batches WHERE scope_key=?)";
  const stateParams=existing?[batchId,existing.revision]:[scopeKey];
  await atomic(db,identity,id,predicate.sql+' AND '+stateGuard,[...predicate.params,...stateParams],[statement(db,
    `INSERT INTO vendor_order_batches(batch_id,scope_key,branch_id,service_date,floors_json,snapshot_json,snapshot_hash,state,created_by,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,'DRAFT',?,?,?) ON CONFLICT(scope_key) DO UPDATE SET snapshot_json=excluded.snapshot_json,snapshot_hash=excluded.snapshot_hash,state='DRAFT',reviewed_by=NULL,revision=revision+1,updated_at=excluded.updated_at`,
    [batchId,scopeKey,id,date,canonicalJson(floors),canonicalJson(context.snapshot),context.snapshotHash,identity.actor.userId,now.toISOString(),now.toISOString()]),
    statement(db,'DELETE FROM vendor_order_items WHERE batch_id=?',[batchId]),...context.snapshot.sourceItems.map(item=>statement(db,
      'INSERT INTO vendor_order_items(batch_id,source_order_id,source_line_no,item_json) VALUES (?,?,?,?)',[batchId,item.sourceOrderId,item.lineNo,canonicalJson(item)])),
    audit(db,identity,id,batchId,'PREPARED',context.snapshotHash,now)]);
  return publicBatch(await loadBatch(db,identity,batchId));
};
export const getVendorBatch=async(db,identity,id,now)=>{
  const row=await loadBatch(db,identity,id),b=await branch(db,row.branch_id),saved=JSON.parse(row.snapshot_json);
  const attempt=await statement(db,'SELECT attempt_id AS attemptId,external_reference AS externalReference,reported_amount AS reportedAmount,payment_status AS paymentStatus,evidence_source AS evidenceSource,platform_verified AS platformVerified FROM vendor_order_attempts WHERE batch_id=?',[id]).first();
  let context=null,liveSnapshotError=null;
  try{context=await createVendorSnapshot(db,b,row.service_date,JSON.parse(row.floors_json),now,saved.noteReviews);}
  catch(error){if(!attempt)throw error;liveSnapshotError=error.code==='VENDOR_ORDER_SNAPSHOT_TOO_LARGE'?error.code:'VENDOR_ORDER_LIVE_SNAPSHOT_UNAVAILABLE';}
  const live=await reconciliationSource(db,row,saved),sourceChanged=saved.guard.source!==live.source;
  // Permanent claims made by this very handoff are not source/config drift.
  // Full snapshot/claim checks remain mandatory before review and handoff.
  const snapshotChanged=attempt?(!context||sourceChanged||['mappings','menu'].some(key=>saved.guard[key]!==context.snapshot.guard[key])
    ||saved.branchRevision!==b.revision||saved.vendor!==b.vendor||saved.branchLabel!==b.label||canonicalJson(saved.policy)!==canonicalJson(b.policy)
    ||Boolean(b.vendor_enabled)!==!saved.warnings.includes('VENDOR_DISABLED')):row.snapshot_hash!==context.snapshotHash;
  return {...publicBatch(row),currentSnapshot:context?publicSnapshot(context.snapshot):null,liveSnapshotError,sourceChanged,
    snapshotChanged,attempt:attempt?{...attempt,platformVerified:false}:null,
    audit:await rows(db,`SELECT action,actor_user_id AS actorUserId,snapshot_hash AS snapshotHash,metadata_json AS metadataJson,occurred_at AS occurredAt
      FROM vendor_order_audit WHERE batch_id=? ORDER BY occurred_at,audit_id LIMIT 100`,[id])};
};
export const listVendorBatches=async(db,identity,branchId)=>{
  boundedText(branchId);await authorizeVendorOrders(db,identity,branchId);
  return {batches:(await rows(db,'SELECT * FROM vendor_order_batches WHERE branch_id=? ORDER BY updated_at DESC,batch_id LIMIT 50',[branchId])).map(publicBatch)};
};
export const reviewVendorBatch=async(db,identity,id,input,now)=>{
  const row=await loadBatch(db,identity,id),b=await branch(db,row.branch_id),context=await createVendorSnapshot(db,b,row.service_date,JSON.parse(row.floors_json),now,JSON.parse(row.snapshot_json).noteReviews);
  if(input.snapshotHash!==row.snapshot_hash||context.snapshotHash!==row.snapshot_hash)throw conflict('VENDOR_ORDER_STALE_SNAPSHOT');
  if(context.snapshot.warnings.length)throw conflict('VENDOR_ORDER_REVIEW_BLOCKED');
  const predicate=snapshotPredicate(b,context);
  await atomic(db,identity,b.branch_id,predicate.sql+" AND EXISTS(SELECT 1 FROM vendor_order_batches WHERE batch_id=? AND revision=? AND snapshot_hash=? AND state='DRAFT')",
    [...predicate.params,id,row.revision,row.snapshot_hash],[statement(db,"UPDATE vendor_order_batches SET state='READY',reviewed_by=?,revision=revision+1,updated_at=? WHERE batch_id=?",[identity.actor.userId,now.toISOString(),id]),
      audit(db,identity,b.branch_id,id,'REVIEWED',row.snapshot_hash,now)]);
  return publicBatch(await loadBatch(db,identity,id));
};
const sheetFor=row=>{const snapshot=JSON.parse(row.snapshot_json);return {
  kind:'MANUAL_HANDOFF',warning:'Internal reservation only. Do not resend. Merchant acceptance and payment require manual reconciliation.',
  branch:snapshot.branchLabel,vendor:snapshot.vendor,serviceDate:snapshot.serviceDate,address:snapshot.address,floors:snapshot.floors,
  rows:snapshot.rows,quantity:snapshot.quantity,internalAmount:snapshot.internalAmount,externalAmount:snapshot.externalAmount,shippingFee:snapshot.shippingFee,
  amountDifference:snapshot.amountDifference,paymentResponsibility:snapshot.policy.paymentResponsibility,supplierNote:snapshot.policy.supplierNote,
  officialWebsite:normalizeMenuVendor(snapshot.vendor)===HISTORICAL_SQL_VENDOR?'https://imenu.com.tw/vegetsai/branches':null,snapshotHash:row.snapshot_hash
};};
const handoffResult=(row,attempt,replayed)=>({...publicBatch(row),sheet:sheetFor(row),attemptId:attempt.attempt_id,replayed,evidenceSource:'MANUAL_REPORTED',platformVerified:false});
export const getVendorHandoffSheet=async(db,identity,id)=>{
  const row=await loadBatch(db,identity,id),attempt=await statement(db,'SELECT * FROM vendor_order_attempts WHERE batch_id=?',[id]).first();
  if(!attempt)throw conflict('VENDOR_ORDER_HANDOFF_NOT_CLAIMED');
  return handoffResult(row,attempt,true);
};
export const handoffVendorBatch=async(db,identity,id,input,key,now)=>{
  const row=await loadBatch(db,identity,id);
  if(input.adapter!=='MANUAL')throw forbidden('VENDOR_ORDER_ADAPTER_DISABLED');
  if(input.confirm!==true||input.snapshotHash!==row.snapshot_hash)throw badRequest('VENDOR_ORDER_FINAL_CONFIRM_REQUIRED');
  key=requireIdempotencyKey(key);
  const existing=await statement(db,'SELECT * FROM vendor_order_attempts WHERE batch_id=?',[id]).first();
  if(existing){if(existing.snapshot_hash!==input.snapshotHash)throw conflict('VENDOR_ORDER_RECONCILE_REQUIRED');return handoffResult(row,existing,true);}
  const used=await statement(db,'SELECT attempt_id FROM vendor_order_attempts WHERE idempotency_key=?',[key]).first();
  if(used)throw conflict('VENDOR_ORDER_KEY_CONFLICT');
  const b=await branch(db,row.branch_id),context=await createVendorSnapshot(db,b,row.service_date,JSON.parse(row.floors_json),now,JSON.parse(row.snapshot_json).noteReviews);
  if(context.snapshotHash!==row.snapshot_hash)throw conflict('VENDOR_ORDER_STALE_SNAPSHOT');
  if(context.snapshot.warnings.length)throw conflict('VENDOR_ORDER_REVIEW_BLOCKED');
  const predicate=snapshotPredicate(b,context),attemptId=randomId('VOT');
  // Current SQL clock, including across a delayed JS read, is authoritative.
  const condition=predicate.sql+` AND julianday('now')>=julianday(?) AND julianday('now')<julianday(?)
    AND EXISTS(SELECT 1 FROM vendor_order_batches WHERE batch_id=? AND revision=? AND snapshot_hash=? AND state='READY' AND reviewed_by IS NOT NULL)
    AND NOT EXISTS(SELECT 1 FROM vendor_order_attempts WHERE batch_id=?)`;
  await atomic(db,identity,b.branch_id,condition,[...predicate.params,context.snapshot.window.internalClose,context.snapshot.window.externalClose,id,row.revision,row.snapshot_hash,id],[statement(db,
    "INSERT INTO vendor_order_attempts(attempt_id,batch_id,snapshot_hash,idempotency_key,adapter,actor_user_id,created_at) VALUES (?,?,?,?,'MANUAL',?,?)",
    [attemptId,id,row.snapshot_hash,key,identity.actor.userId,now.toISOString()]),...context.snapshot.sourceItems.map(item=>statement(db,
      'INSERT INTO vendor_order_source_claims(source_order_id,source_line_no,attempt_id) VALUES (?,?,?)',[item.sourceOrderId,item.lineNo,attemptId])),
    ...[...new Set(context.snapshot.sourceItems.map(item=>item.ownerUserId))].map(owner=>statement(db,
      'INSERT INTO vendor_order_owner_claims(owner_user_id,service_date,vendor,attempt_id) VALUES (?,?,?,?)',[owner,row.service_date,normalizeMenuVendor(b.vendor),attemptId])),
    statement(db,"UPDATE vendor_order_batches SET state='SUBMITTING',revision=revision+1,updated_at=? WHERE batch_id=?",[now.toISOString(),id]),
    audit(db,identity,b.branch_id,id,'MANUAL_HANDOFF_CLAIMED',row.snapshot_hash,now)]);
  return handoffResult(await loadBatch(db,identity,id),{attempt_id:attemptId},false);
};
const TRANSITIONS={SUBMITTING:['SUBMITTED','UNKNOWN','FAILED'],SUBMITTED:['ACCEPTED','REJECTED','CANCELLED','UNKNOWN'],UNKNOWN:['SUBMITTED','ACCEPTED','REJECTED','CANCELLED','FAILED'],FAILED:['UNKNOWN','CANCELLED'],ACCEPTED:['CANCELLED'],REJECTED:[],CANCELLED:[]};
// Reconciliation belongs to the frozen attempt. Live preparation limits must
// not prevent recording its outcome. Keep a current source fingerprint so a
// concurrent source edit still requires an explicit refresh before reporting.
const reconciliationSource=async(db,row,saved)=>{
  const sourceParams=[canonicalJson(compatibilityVendorCandidates(saved.vendor)),row.service_date,canonicalJson(saved.floors)];
  const live=await statement(db,`SELECT (${SOURCE_SQL}) source,(SELECT COUNT(*) FROM vendor_item_mappings WHERE branch_id=? AND service_date=?) mappingsCount`,[...sourceParams,row.branch_id,row.service_date]).first();
  return {...live,sourceParams,liveSnapshotError:JSON.parse(live.source).length>200||live.mappingsCount>300?'VENDOR_ORDER_SNAPSHOT_TOO_LARGE':null};
};
export const reportVendorBatch=async(db,identity,id,input,now)=>{
  const row=await loadBatch(db,identity,id),revision=integer(input.expectedRevision);
  if(!TRANSITIONS[row.state]?.includes(input.state))throw conflict('VENDOR_ORDER_TRANSITION_INVALID');
  if(!['UNCONFIRMED','UNPAID','PAID'].includes(input.paymentStatus))throw badRequest('VENDOR_ORDER_PAYMENT_INVALID');
  const reference=input.externalReference?boundedText(input.externalReference):null,amount=integer(input.reportedAmount);
  const saved=JSON.parse(row.snapshot_json),live=await reconciliationSource(db,row,saved);
  const changed=saved.guard.source!==live.source;
  await atomic(db,identity,row.branch_id,`EXISTS(SELECT 1 FROM vendor_order_batches WHERE batch_id=? AND revision=? AND state=?)
    AND EXISTS(SELECT 1 FROM vendor_order_attempts WHERE batch_id=?) AND (${SOURCE_SQL})=?`,
    [id,revision,row.state,id,...live.sourceParams,live.source],[statement(db,'UPDATE vendor_order_batches SET state=?,revision=revision+1,updated_at=? WHERE batch_id=?',[input.state,now.toISOString(),id]),
      statement(db,'UPDATE vendor_order_attempts SET external_reference=?,reported_amount=?,payment_status=?,report_json=? WHERE batch_id=?',
        [reference,amount,input.paymentStatus,canonicalJson({state:input.state,sourceChanged:changed,liveSnapshotError:live.liveSnapshotError,externalReference:reference,reportedAt:now.toISOString()}),id]),
      audit(db,identity,row.branch_id,id,'MANUAL_REPORTED',row.snapshot_hash,now,{revision:revision+1,state:input.state,sourceChanged:changed,liveSnapshotError:live.liveSnapshotError,externalReference:reference,reportedAmount:amount,paymentStatus:input.paymentStatus})]);
  return {...publicBatch(await loadBatch(db,identity,id)),sourceChanged:changed,liveSnapshotError:live.liveSnapshotError,evidenceSource:'MANUAL_REPORTED',platformVerified:false};
};

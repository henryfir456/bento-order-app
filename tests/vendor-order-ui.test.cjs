const assert=require('node:assert/strict');
const {test}=require('node:test');
const {buildSync}=require('esbuild');
const {renderToStaticMarkup}=require('react-dom/server');
const React=require('react');
const vm=require('node:vm');
const path=require('node:path');
const {createHarness}=require('./helpers/app-auth-harness.cjs');
const {createAuthSessionStore}=require('../src/auth/sessionStore.js');
const loadWorkspace=()=>{
  const result=buildSync({entryPoints:[path.join(__dirname,'../src/features/vendorOrders/VendorOrderBatches.jsx')],bundle:true,write:false,platform:'node',format:'cjs',jsx:'automatic',external:['react','react/jsx-runtime']});
  const module={exports:{}};vm.runInNewContext(result.outputFiles[0].text,{module,exports:module.exports,require,Intl,Date});return module.exports.VendorOrderWorkspace;
};
const nodes=tree=>{if(!tree||typeof tree!=='object')return [];return [tree,...React.Children.toArray(tree.props?.children).flatMap(nodes)];};
const response=body=>Response.json({success:true,...body});
test('actual App tab handler opens authenticated admin workspace and View As removes it',async()=>{
  const api={transport:'worker',getBootstrap:async()=>response({registered:true,authMode:'line',user:{userId:'admin',employeeId:'001',name:'Admin',role:'Admin',active:true,lineBound:true,identityState:'VERIFIED'},calendar:{events:{}},ordersMap:{}}),getDeferredBootstrap:async({bootId})=>response({bootId})};
  const app=createHarness({renderJsx:true,store:createAuthSessionStore({getItem:()=>null,setItem(){},removeItem(){}}),apiClient:api,authClient:{isMock:false,init:async()=>{},isLoggedIn:()=>true,isInClient:()=>false,getAccessToken:()=> 'token'}});
  await app.settle();const tab=nodes(app.view.renderedTree).find(n=>n.type==='button'&&n.props.children==='集中訂單轉單');assert.ok(tab);
  tab.props.onClick();await app.settle();assert.ok(nodes(app.view.renderedTree).some(n=>n.props?.apiClient===api));
  app.view.setViewAsUser({userId:'subject',role:'Admin'});await app.settle();
  assert.ok(!nodes(app.view.renderedTree).some(n=>n.props?.apiClient===api));assert.ok(!nodes(app.view.renderedTree).some(n=>n.type==='button'&&n.props.children==='集中訂單轉單'));app.destroy();
});
test('actual workspace renders configuration, blockers, protected notes and frozen confirmation',()=>{
  const Workspace=loadWorkspace();const policy={enabled:false,onlineOrderingConfirmed:false,addressConfirmed:false,address:'Synthetic address',floors:['1F'],serviceDates:['2026-10-11'],weekdays:[1,2,3,4,5],closedDates:[],internalMode:'A',internalCutoff:'10:00',externalCutoff:'10:30',deliveryStart:'11:00',deliveryEnd:'13:00',minimumAmount:300,freeShippingThreshold:300,shippingFee:0,supplierNote:''};
  const batch={batchId:'batch',branchId:'branch',serviceDate:'2026-10-11',state:'DRAFT',revision:1,snapshotHash:'hash',snapshot:{policy,floors:['1F'],quantity:1,internalAmount:80,externalItemsAmount:80,shippingFee:0,externalAmount:80,amountDifference:0,warnings:['UNMAPPED','SOURCE_NOTES_REQUIRE_REVIEW'],sourceNotes:[{sourceOrderId:'order',sourceNoteHash:'note-hash',note:'private-original'}],sourceItems:[{sourceOrderId:'order',lineNo:1,floor:'1F',menuItemId:'mi',itemCode:'S',variantKey:'HALF',quantity:1,unitPrice:80,subtotal:80}],rows:[]}};
  const state={access:{canConfigure:true,branches:[{branchId:'branch',label:'Synthetic',vendorId:'vendor',vendor:'Vendor',revision:1,policy,mappings:[]}]},vendors:[{id:'vendor',name:'Vendor'}],selection:{branchId:'branch',serviceDate:'2026-10-11',floors:['1F']},batch,batches:[],noteReviews:[],sheet:null,busy:false,error:'',notesDirty:false};
  const html=renderToStaticMarkup(React.createElement(Workspace,{state,flow:{}}));
  for(const text of ['品項映射','分店規則設定','ProxyAdmin 授權','品項未映射','來源備註尚未逐筆確認','private-original','不會向員工再次扣款'])assert.ok(html.includes(text),text);
  assert.ok(html.includes('disabled=""'));assert.ok(!html.includes('href="https://'));
  const ready=renderToStaticMarkup(React.createElement(Workspace,{state:{...state,batch:{...batch,state:'READY',snapshot:{...batch.snapshot,warnings:[]}}},flow:{}}));
  assert.ok(ready.includes('保留並取得人工轉單單據'));assert.ok(ready.includes('disabled=""'));
});
test('UNKNOWN displays manual recovery/reporting, safe sheet and no final reserve button',()=>{
  const Workspace=loadWorkspace();const batch={batchId:'batch',state:'UNKNOWN',revision:3,snapshotHash:'hash',snapshot:{quantity:1,internalAmount:80,externalItemsAmount:80,shippingFee:0,externalAmount:80,amountDifference:0,warnings:[],sourceNotes:[],sourceItems:[],rows:[]},attempt:{externalReference:'reference',paymentStatus:'UNCONFIRMED'},audit:[{action:'MANUAL_REPORTED',actorUserId:'admin',metadataJson:'{"externalReference":"old-reference"}',occurredAt:'2026-10-10'}]};
  const sheet={kind:'MANUAL_HANDOFF',rows:[{supplierNote:'Approved note'}],officialWebsite:'https://imenu.com.tw/vegetsai/branches'};
  const html=renderToStaticMarkup(React.createElement(Workspace,{state:{access:null,selection:{},batch,sheet,batches:[],busy:false,error:'',noteReviews:[]},flow:{}}));
  assert.ok(html.includes('UNKNOWN'));assert.ok(html.includes('人工回報'));assert.ok(html.includes('Approved note'));assert.ok(html.includes('old-reference'));assert.ok(html.includes('noopener noreferrer'));
  assert.ok(!html.includes('保留並取得人工轉單單據'));assert.ok(!html.includes('private-original'));assert.ok(html.includes('尚未經平台驗證'));
});

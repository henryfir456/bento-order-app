import { useEffect, useState, useSyncExternalStore } from 'react';
import { createVendorOrderWorkflow, REPORT_TRANSITIONS } from './vendorOrderWorkflow';

const inputClass='w-full rounded border border-slate-300 p-2 text-sm bg-white';
const buttonClass='rounded bg-emerald-700 px-3 py-2 text-sm text-white disabled:opacity-40';
const split=value=>String(value||'').split(',').map(x=>x.trim()).filter(Boolean);
const taipeiToday=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const Field=({label,children})=><label className="block text-sm space-y-1"><span>{label}</span>{children}</label>;
const Check=({label,checked,onChange})=><label className="flex gap-2 text-sm"><input type="checkbox" checked={Boolean(checked)} onChange={event=>onChange(event.target.checked)}/>{label}</label>;

function BranchForm({branch,vendors,busy,onSave}){
  const [form,setForm]=useState(()=>({branchId:branch?.branchId||'',vendorId:branch?.vendorId||'',label:branch?.label||'',
    ...(branch?.policy||{enabled:false,onlineOrderingConfirmed:false,addressConfirmed:false,address:'',floors:['1F'],serviceDates:[],weekdays:[1,2,3,4,5],closedDates:[],internalMode:'A',internalCutoff:'10:00',externalCutoff:'10:30',deliveryStart:'11:00',deliveryEnd:'13:00',minimumAmount:300,freeShippingThreshold:300,shippingFee:0,supplierNote:''}),
    floors:branch?.policy.floors.join(',')||'1F',serviceDates:branch?.policy.serviceDates.join(',')||'',closedDates:branch?.policy.closedDates.join(',')||''}));
  const set=(key,value)=>setForm(prev=>({...prev,[key]:value}));
  const text=(label,key,type='text')=><Field key={key} label={label}><input required={key!=='supplierNote'} type={type} className={inputClass} value={form[key]} onChange={e=>set(key,e.target.value)} maxLength={key==='address'||key==='supplierNote'?500:200}/></Field>;
  return <details className="rounded border p-3"><summary className="cursor-pointer font-semibold">{branch?'分店規則設定':'新增人工轉單分店'}</summary>
    <p className="text-sm my-2">請以店家確認內容設定；網站公告不代表這個分店今天可以承接。時間皆為台北時間。</p>
    <form onSubmit={e=>{e.preventDefault();onSave(form.branchId,{vendorId:form.vendorId,label:form.label,expectedRevision:branch?.revision||0,policy:{...form,floors:split(form.floors),serviceDates:split(form.serviceDates),closedDates:split(form.closedDates),minimumAmount:Number(form.minimumAmount),freeShippingThreshold:Number(form.freeShippingThreshold),shippingFee:Number(form.shippingFee),paymentResponsibility:'ORGANIZER_SETTLES_VENDOR'}});}}>
      <fieldset disabled={busy} className="grid sm:grid-cols-2 gap-3 my-3">
        {branch?<p className="text-sm">分店 ID：{form.branchId}</p>:text('分店 ID（唯一代碼）','branchId')}
        <Field label="既有供應商"><select required disabled={Boolean(branch)} className={inputClass} value={form.vendorId} onChange={e=>set('vendorId',e.target.value)}><option value="">請選擇</option>{vendors.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}</select></Field>
        {text('分店名稱','label')}{text('送達地址','address')}{text('支援樓層，以逗號分隔','floors')}
        {text('店家確認可服務日期 YYYY-MM-DD，以逗號分隔','serviceDates')}
        <Field label="休店日期 YYYY-MM-DD，以逗號分隔"><input className={inputClass} value={form.closedDates} onChange={e=>set('closedDates',e.target.value)}/></Field>
        <Field label="每週可服務日"><div className="flex flex-wrap gap-2">{['日','一','二','三','四','五','六'].map((day,index)=><Check key={day} label={day} checked={form.weekdays.includes(index)} onChange={checked=>set('weekdays',checked?[...form.weekdays,index]:form.weekdays.filter(x=>x!==index))}/>)}</div></Field>
        <Field label="內部收單模式"><select className={inputClass} value={form.internalMode} onChange={e=>setForm(prev=>({...prev,internalMode:e.target.value,internalCutoff:e.target.value==='B'?'18:00':'10:00'}))}><option value="A">A：當日截止</option><option value="B">B：前一日截止</option></select></Field>
        {text('內部截止時間','internalCutoff','time')}{text('店家外部截止時間','externalCutoff','time')}{text('送達時段開始','deliveryStart','time')}{text('送達時段結束','deliveryEnd','time')}
        {text('最低商品金額（元）','minimumAmount','number')}{text('免運商品金額（元）','freeShippingThreshold','number')}{text('未達免運時運費（元）','shippingFee','number')}{text('已確認給店家的整批備註','supplierNote')}
        <Check label="啟用這個人工分店" checked={form.enabled} onChange={v=>set('enabled',v)}/>
        <Check label="已與店家確認此分店可承接" checked={form.onlineOrderingConfirmed} onChange={v=>set('onlineOrderingConfirmed',v)}/>
        <Check label="已確認送達地址與樓層範圍" checked={form.addressConfirmed} onChange={v=>set('addressConfirmed',v)}/>
        <p className="text-sm">由組織者向店家付款；不會再次向員工扣款。</p><button className={buttonClass}>儲存規則</button>
      </fieldset>
    </form></details>;
}

function MappingForm({branch,batch,busy,onSave}){
  const items=[...new Map((batch?.snapshot.sourceItems||[]).filter(i=>i.menuItemId&&i.variantKey).map(i=>[i.menuItemId+'|'+i.variantKey,i])).values()];
  const [itemKey,setItemKey]=useState(''),[sku,setSku]=useState(''),[options,setOptions]=useState(''),[price,setPrice]=useState(''),[available,setAvailable]=useState(false);
  const item=items.find(i=>i.menuItemId+'|'+i.variantKey===itemKey);
  const mapping=branch.mappings.find(m=>m.menuItemId===item?.menuItemId&&m.variantKey===item?.variantKey&&m.serviceDate===batch.serviceDate);
  return <details className="rounded border p-3"><summary className="font-semibold cursor-pointer">品項映射（先產生預覽）</summary><form onSubmit={e=>{e.preventDefault();if(item)onSave({menuItemId:item.menuItemId,variantKey:item.variantKey,serviceDate:batch.serviceDate,externalSku:sku,options:split(options),externalUnitPrice:Number(price),available,expectedRevision:mapping?.revision||0});}}><fieldset disabled={busy||!batch} className="grid sm:grid-cols-2 gap-3 my-3">
    <Field label="穩定品項 ID／變體"><select required className={inputClass} value={itemKey} onChange={e=>{setItemKey(e.target.value);const chosen=items.find(i=>i.menuItemId+'|'+i.variantKey===e.target.value);const found=branch.mappings.find(m=>m.menuItemId===chosen?.menuItemId&&m.variantKey===chosen?.variantKey&&m.serviceDate===batch.serviceDate);setSku(found?.externalSku||'');setOptions(found?JSON.parse(found.optionsJson).join(','):'');setPrice(found?.externalUnitPrice??'');setAvailable(Boolean(found?.available));}}><option value="">請選擇來源品項</option>{items.map(i=><option key={i.menuItemId+'|'+i.variantKey} value={i.menuItemId+'|'+i.variantKey}>{i.itemCode}／{i.variantKey}／{i.menuItemId}</option>)}</select></Field>
    <Field label="店家 SKU"><input required className={inputClass} value={sku} maxLength={200} onChange={e=>setSku(e.target.value)}/></Field>
    <Field label="選項代碼，逗號分隔"><input className={inputClass} value={options} onChange={e=>setOptions(e.target.value)}/></Field>
    <Field label="店家確認單價（元）"><input required min="0" step="1" type="number" className={inputClass} value={price} onChange={e=>setPrice(e.target.value)}/></Field>
    <Check label="已確認今日有供應" checked={available} onChange={setAvailable}/><button className={buttonClass} disabled={!item}>儲存映射（之後重新預覽）</button>
  </fieldset></form></details>;
}

function GrantForm({busy,onSave}){
  const [userId,setUserId]=useState(''),[expiresAt,setExpiresAt]=useState(''),[revoked,setRevoked]=useState(false);
  return <details className="rounded border p-3"><summary className="cursor-pointer font-semibold">分店 ProxyAdmin 授權</summary><form onSubmit={e=>{e.preventDefault();onSave({userId,expiresAt:new Date(expiresAt).toISOString(),revoked});}}><fieldset disabled={busy} className="grid sm:grid-cols-2 gap-3 my-3">
    <Field label="已驗證 ProxyAdmin 的 canonical user ID"><input required className={inputClass} value={userId} onChange={e=>setUserId(e.target.value)}/></Field>
    <Field label="授權到期時間（此裝置時區）"><input required type="datetime-local" className={inputClass} value={expiresAt} onChange={e=>setExpiresAt(e.target.value)}/></Field>
    <Check label="撤銷授權" checked={revoked} onChange={setRevoked}/><button className={buttonClass}>儲存這個分店授權</button>
  </fieldset></form></details>;
}

function ReportForm({batch,busy,onSave}){
  const choices=REPORT_TRANSITIONS[batch.state]||[];
  const [status,setStatus]=useState(choices.includes('UNKNOWN')?'UNKNOWN':choices[0]||''),[reference,setReference]=useState(batch.attempt?.externalReference||''),[amount,setAmount]=useState(batch.attempt?.reportedAmount??batch.snapshot.externalAmount),[payment,setPayment]=useState(batch.attempt?.paymentStatus||'UNCONFIRMED');
  if(!choices.length)return <p>此批次已終止，只能讀取紀錄，不能重送。</p>;
  return <form onSubmit={e=>{e.preventDefault();onSave({state:status,externalReference:reference,reportedAmount:Number(amount),paymentStatus:payment});}}><fieldset disabled={busy} className="grid sm:grid-cols-2 gap-3 border rounded p-3">
    <p className="sm:col-span-2 text-sm">人工回報：尚未經平台驗證。已送出不等於店家已接受。結果不明請選 UNKNOWN 並人工對帳，不要重送。</p>
    <Field label="人工確認狀態"><select className={inputClass} value={status} onChange={e=>setStatus(e.target.value)}>{choices.map(s=><option key={s}>{s}</option>)}</select></Field>
    <Field label="外部單號／對帳參考"><input maxLength={200} className={inputClass} value={reference} onChange={e=>setReference(e.target.value)}/></Field>
    <Field label="店家人工確認金額（元）"><input required min="0" step="1" type="number" className={inputClass} value={amount} onChange={e=>setAmount(e.target.value)}/></Field>
    <Field label="向店家付款狀態"><select className={inputClass} value={payment} onChange={e=>setPayment(e.target.value)}><option value="UNCONFIRMED">尚未確認</option><option value="UNPAID">未付款</option><option value="PAID">人工確認已付款</option></select></Field>
    <button className={buttonClass}>記錄人工回報</button>
  </fieldset></form>;
}

const warningLabels={UNMAPPED:'品項未映射',IDENTITY_AMBIGUOUS:'來源品項身份不明',PRICE_DIFFERENCE:'內外價格不同',EXTERNAL_PRICE_CONFLICT:'相同 SKU 單價衝突',ADDRESS_UNSUPPORTED:'地址或樓層未確認',MINIMUM_NOT_MET:'未達最低金額',SERVICE_UNAVAILABLE:'日期不供應',OUT_OF_STOCK:'品項無供應',COLLECTION_OPEN:'內部收單尚未截止',EXTERNAL_CUTOFF_PASSED:'店家截止時間已過',BRANCH_UNCONFIRMED:'分店未確認',SOURCE_NOTES_REQUIRE_REVIEW:'來源備註尚未逐筆確認',SOURCE_ALREADY_CLAIMED:'來源品項已保留',SCOPE_ALREADY_CLAIMED:'樓層範圍已保留',OWNER_ALREADY_CLAIMED:'員工餐點已保留，需人工對帳'};
export function VendorOrderWorkspace({state,flow}){
  const {access,selection,batch,sheet,busy,error}=state;
  const branch=access?.branches.find(b=>b.branchId===selection.branchId);
  const [confirmed,setConfirmed]=useState('');
  const confirmationKey=batch?batch.batchId+':'+batch.snapshotHash+':'+batch.revision:'';
  const finalConfirmed=Boolean(confirmationKey&&confirmed===confirmationKey);
  const select=patch=>{setConfirmed('');flow.select({...selection,...patch});};
  return <section className="rounded-xl bg-white p-4 shadow space-y-4" aria-label="集中訂單人工轉單">
    <h2 className="text-lg font-bold">集中訂單・人工轉單</h2>
    <p className="text-sm">官方 API 尚未啟用。此處只產生人工單與對帳紀錄，需由授權組織者另行向店家操作及付款，不會向員工再次扣款。</p>
    {error&&<p role="alert" className="text-red-700">{error}</p>}
    <button className={buttonClass} disabled={busy} onClick={()=>flow.load()}>重新讀取授權</button>
    {busy&&<p role="status">讀取／記錄中…</p>}
    {access&&<>
      <fieldset disabled={busy} className="grid sm:grid-cols-2 gap-3">
        <Field label="已授權分店"><select className={inputClass} value={selection.branchId} onChange={e=>select({branchId:e.target.value,floors:access.branches.find(b=>b.branchId===e.target.value)?.policy.floors||[]})}><option value="">請選擇</option>{access.branches.map(b=><option key={b.branchId} value={b.branchId}>{b.vendor}・{b.label}</option>)}</select></Field>
        <Field label="用餐日期（台北）"><input type="date" className={inputClass} value={selection.serviceDate} onChange={e=>select({serviceDate:e.target.value})}/></Field>
        {branch&&<Field label="這批包含樓層"><div className="flex gap-3">{branch.policy.floors.map(f=><Check key={f} label={f} checked={selection.floors.includes(f)} onChange={on=>select({floors:on?[...selection.floors,f]:selection.floors.filter(x=>x!==f)})}/>)}</div></Field>}
      </fieldset>
      {access.canConfigure&&<BranchForm key={branch?branch.branchId+':'+branch.revision:'new'} branch={branch} vendors={state.vendors} busy={busy} onSave={flow.configure}/>}
      {branch&&<>
        {access.canConfigure&&<GrantForm key={branch.branchId} busy={busy} onSave={flow.grant}/>}
        <div className="flex flex-wrap gap-2"><button className={buttonClass} disabled={busy||!selection.serviceDate||!selection.floors.length||state.uncertain||Boolean(batch&&!['DRAFT','READY'].includes(batch.state))} onClick={()=>flow.prepare()}>產生／更新預覽（含備註審核）</button><button className={buttonClass} disabled={busy} onClick={()=>flow.list()}>讀取既有批次，避免重複轉單</button></div>
        {state.batches.length>0&&<ul className="space-y-2">{state.batches.map(b=><li key={b.batchId}><button className="underline text-sm" disabled={busy} onClick={()=>flow.openBatch(b.batchId)}>{b.serviceDate}／{b.snapshot.floors.join(',')}／{b.state}／{b.batchId}</button></li>)}</ul>}
        {access.canConfigure&&<MappingForm key={branch.branchId+':'+branch.revision+':'+batch?.snapshotHash} branch={branch} batch={batch} busy={busy} onSave={flow.mapping}/>}
      </>}
    </>}
    {batch&&<>
      <p className="font-semibold">批次 {batch.batchId}：{batch.state} ／ revision {batch.revision}</p>
      <p className="text-sm break-all">審核快照：{batch.snapshotHash}</p>
      <p>來源數量 {batch.snapshot.quantity}／員工原金額 ${batch.snapshot.internalAmount}／店家商品 ${batch.snapshot.externalItemsAmount}＋運費 ${batch.snapshot.shippingFee}＝${batch.snapshot.externalAmount}／差額 ${batch.snapshot.amountDifference}</p>
      <p className="text-sm">內部截止 {batch.snapshot.window?.internalClose} ／店家截止 {batch.snapshot.window?.externalClose}（以上 ISO 為 UTC）；送達 {batch.snapshot.policy?.deliveryStart}–{batch.snapshot.policy?.deliveryEnd} 台北時間</p>
      <ul className="text-red-700">{batch.snapshot.warnings.map(w=><li key={w}>{warningLabels[w]||w}</li>)}</ul>
      {batch.liveSnapshotError&&<p role="alert">即時預覽無法產生（{batch.liveSnapshotError}）；仍可讀取原凍結人工單並記錄對帳，不需刪除其他訂單或映射。</p>}
      {(batch.sourceChanged||batch.snapshotChanged&&batch.currentSnapshot)&&<div role="alert" className="text-red-700">來源或設定已變動，原人工單不會自動改寫。{batch.currentSnapshot&&<>當前金額 ${batch.currentSnapshot.externalAmount}；當前阻擋：{batch.currentSnapshot.warnings.map(w=>warningLabels[w]||w).join('、')}。</>}請讀取並人工對帳。</div>}
      <div className="overflow-x-auto"><table className="w-full text-sm text-left"><caption className="text-left">受保護的來源品項參考</caption><thead><tr>{['來源訂單／行','樓層','品項／變體','数量','原單價／小計','店家 SKU'].map(x=><th key={x}>{x}</th>)}</tr></thead><tbody>{batch.snapshot.sourceItems.map(i=><tr key={i.sourceOrderId+':'+i.lineNo}><td>{i.sourceOrderId}／{i.lineNo}</td><td>{i.floor}</td><td>{i.itemCode}／{i.variantKey}</td><td>{i.quantity}</td><td>{i.unitPrice}／{i.subtotal}</td><td>{i.externalSku||'未映射'}</td></tr>)}</tbody></table></div>
      {['DRAFT','READY'].includes(batch.state)&&batch.snapshot.sourceNotes.map(n=>{const reviewed=state.noteReviews.find(r=>r.sourceOrderId===n.sourceOrderId);return <fieldset key={n.sourceOrderId+':'+n.sourceNoteHash} disabled={busy} className="border rounded p-3 space-y-2"><p className="text-sm">受保護原始備註（不會直接匯出）：{n.sourceOrderId}：{n.note}</p><Check label="已逐筆確認；只傳遞下方店家需要的內容" checked={Boolean(reviewed)} onChange={checked=>flow.reviewNote(n.sourceOrderId,checked,reviewed?.supplierNote||'')}/>{reviewed&&<Field label="已確認可給店家的備註（可留空）"><input maxLength={500} className={inputClass} value={reviewed.supplierNote} onChange={e=>flow.reviewNote(n.sourceOrderId,true,e.target.value)}/></Field>}</fieldset>;})}
      {state.notesDirty&&<p role="alert">備註審核已編輯，請先「產生／更新預覽」保存新快照，再核准。</p>}
      <div className="flex gap-2"><button className={buttonClass} disabled={busy} onClick={()=>flow.openBatch(batch.batchId)}>重新讀取這批／取回人工單</button>{batch.state==='DRAFT'&&<button className={buttonClass} disabled={busy||state.notesDirty||batch.snapshot.warnings.length>0} onClick={()=>flow.review()}>核准此快照</button>}</div>
      {batch.state==='READY'&&<fieldset disabled={busy||state.notesDirty||state.uncertain} className="border border-amber-500 rounded p-3 space-y-2"><Check label="已確認映射、數量、地址、時間與金額；只保留一份人工單，之後人工向店家操作" checked={finalConfirmed} onChange={v=>setConfirmed(v?confirmationKey:'')}/><button className={buttonClass} disabled={!finalConfirmed} onClick={()=>flow.handoff(finalConfirmed)}>保留並取得人工轉單單據</button></fieldset>}
      {state.uncertain&&<p role="alert">保留結果未確認。請使用上方讀取對帳；不允許直接重送。</p>}
      {sheet&&<div className="border rounded p-3 space-y-2"><h3 className="font-semibold">人工轉單單據：尚未證實店家接單或付款</h3><p className="text-sm">請複製下方單據，勿複製上方原始備註或員工資料。再次讀取不是新轉單。</p><pre className="whitespace-pre-wrap text-xs bg-slate-50 p-2">{JSON.stringify(sheet,null,2)}</pre>{sheet.officialWebsite&&<a href={sheet.officialWebsite} target="_blank" rel="noopener noreferrer" className="underline">店家官方訂購入口（需自行核實分店）</a>}</div>}
      {REPORT_TRANSITIONS[batch.state]&&<ReportForm key={batch.batchId+':'+batch.revision} batch={batch} busy={busy} onSave={flow.report}/>}
      {batch.audit&&<details className="border rounded p-3"><summary>受保護稽核／歷次人工單號</summary><ul className="text-xs space-y-2">{batch.audit.map((a,index)=><li key={index}>{a.occurredAt}／{a.action}／{a.actorUserId}／{a.metadataJson}</li>)}</ul></details>}
    </>}
  </section>;
}

export default function VendorOrderBatches({apiClient}){
  const [flow]=useState(()=>createVendorOrderWorkflow(apiClient));
  const state=useSyncExternalStore(flow.subscribe,flow.getSnapshot,flow.getSnapshot);
  useEffect(()=>{flow.activate();flow.select({branchId:'',serviceDate:taipeiToday(),floors:[]});void flow.load();return()=>flow.dispose();},[flow]);
  return <VendorOrderWorkspace state={state} flow={flow}/>;
}

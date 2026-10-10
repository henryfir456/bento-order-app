const initial=()=>({access:null,vendors:[],selection:{branchId:'',serviceDate:'',floors:[]},batches:[],batch:null,sheet:null,noteReviews:[],notesDirty:false,busy:false,error:'',uncertain:false});
export const REPORT_TRANSITIONS=Object.freeze({SUBMITTING:['SUBMITTED','UNKNOWN','FAILED'],SUBMITTED:['ACCEPTED','REJECTED','CANCELLED','UNKNOWN'],UNKNOWN:['SUBMITTED','ACCEPTED','REJECTED','CANCELLED','FAILED'],FAILED:['UNKNOWN','CANCELLED'],ACCEPTED:['CANCELLED'],REJECTED:[],CANCELLED:[]});
export const vendorOrderUiAllowed=({transport,role,authMode,viewAs})=>transport==='worker'&&authMode==='line'&&!viewAs&&['Admin','ProxyAdmin'].includes(role);
const read=async response=>{
  let body;
  try{body=await response.json();}catch{const error=new Error('轉單回應格式無效，請重新讀取。');error.status=response.status;throw error;}
  // Formal Worker domain responses are raw objects; legacy/mock envelopes
  // may include success. Never require a synthetic success:true from fixtures.
  if(!response.ok||!body||typeof body!=='object'||Array.isArray(body)||body.success===false){const error=new Error(body?.error||body?.code||'轉單操作失敗');error.status=response.status;throw error;}
  return body;
};
export const createVendorOrderWorkflow=api=>{
  let state=initial(),generation=0,disposed=false,lock=null;const listeners=new Set();
  const publish=patch=>{state={...state,...patch};for(const listener of listeners)listener();};
  const clearProtected=()=>publish({access:null,batches:[],batch:null,sheet:null,noteReviews:[]});
  const execute=async work=>{
    if(disposed||lock)return;
    const owner={generation};lock=owner;publish({busy:true,error:''});
    const current=()=>!disposed&&generation===owner.generation&&lock===owner;
    const commit=patch=>{if(current())publish(patch);};
    try{await work(commit,current);}catch(error){if(current()){
      if([401,403].includes(error.status))clearProtected();
      publish({error:error.code||error.message||'操作失敗，請重新讀取對帳。'});
    }}finally{if(lock===owner){lock=null;if(!disposed)publish({busy:false});}}
  };
  const updateBatch=(commit,batch)=>commit({batch,sheet:batch.sheet||null,noteReviews:batch.snapshot?.noteReviews||[],notesDirty:false,selection:{...state.selection,branchId:batch.branchId,serviceDate:batch.serviceDate||state.selection.serviceDate,floors:batch.snapshot?.floors||state.selection.floors}});
  const detail=async(id,commit)=>{
    const batch=await read(await api.getVendorOrderBatch(id));updateBatch(commit,batch);
    if(batch.attempt){const result=await read(await api.getVendorOrderSheet(id));commit({batch:{...batch,...result},sheet:result.sheet});}
    commit({uncertain:false});
  };
  const flow={
    activate:()=>{disposed=false;},
    subscribe:listener=>{listeners.add(listener);return()=>listeners.delete(listener);},getSnapshot:()=>state,
    load:()=>execute(async commit=>{
      const access=await read(await api.getVendorOrderAccess());
      // Read capability before existing vendor metadata; ordinary users never load the workspace.
      const vendors=access.canConfigure?(await read(await api.getVendors())).vendors:[];
      const allowed=access.branches.some(branch=>branch.branchId===state.selection.branchId);
      commit({access,vendors,...(!allowed?{selection:{...state.selection,branchId:'',floors:[]},batches:[],batch:null,sheet:null,noteReviews:[],notesDirty:false,uncertain:false}:{})});
    }),
    select:selection=>{generation++;publish({selection:{...selection,floors:[...selection.floors]},batches:[],batch:null,sheet:null,noteReviews:[],notesDirty:false,uncertain:false,error:''});},
    list:()=>execute(async commit=>commit({batches:(await read(await api.listVendorOrderBatches(state.selection.branchId))).batches})),
    openBatch:id=>execute(async commit=>detail(id,commit)),
    prepare:()=>execute(async commit=>{
      if(state.uncertain||state.batch&&!['DRAFT','READY'].includes(state.batch.state))throw new Error('已保留或結果不明，請讀取原批次對帳。');
      const batch=await read(await api.prepareVendorOrderBatch({...state.selection,noteReviews:state.noteReviews}));
      updateBatch(commit,batch);
    }),
    reviewNote:(sourceOrderId,reviewed,supplierNote)=>{
      if(state.busy)return;
      const note=state.batch?.snapshot.sourceNotes.find(n=>n.sourceOrderId===sourceOrderId);if(!note)return;
      const reviews=state.noteReviews.filter(n=>n.sourceOrderId!==sourceOrderId);
      if(reviewed)reviews.push({sourceOrderId,sourceNoteHash:note.sourceNoteHash,reviewed:true,supplierNote});
      publish({noteReviews:reviews,notesDirty:true});
    },
    review:()=>execute(async commit=>{
      if(state.notesDirty||state.batch?.state!=='DRAFT'||state.batch.snapshot.warnings.length)throw new Error('請先消除阻擋項目並重新產生快照。');
      updateBatch(commit,await read(await api.reviewVendorOrderBatch(state.batch.batchId,{snapshotHash:state.batch.snapshotHash})));
    }),
    handoff:confirm=>execute(async(commit,current)=>{
      if(!confirm||state.notesDirty||state.uncertain||state.batch?.state!=='READY')return;
      const batch=state.batch,key='vendor-manual:'+batch.batchId+':'+batch.snapshotHash;
      commit({uncertain:true});
      try{const result=await read(await api.handoffVendorOrderBatch(batch.batchId,{adapter:'MANUAL',confirm:true,snapshotHash:batch.snapshotHash},key));updateBatch(commit,result);commit({uncertain:false});}
      catch(error){if(!current())return;if([401,403].includes(error.status))throw error;
        // A timeout may follow a committed reservation. Recover only with GET.
        await detail(batch.batchId,commit);commit({error:'轉單回應未確認，已讀取原批次；請檢查狀態與人工單，不要重複送出。'});
      }
    }),
    report:body=>execute(async commit=>{
      const batch=state.batch;if(!REPORT_TRANSITIONS[batch?.state]?.includes(body.state))throw new Error('此狀態不可回報，請先讀取原批次。');
      await read(await api.reportVendorOrderBatch(batch.batchId,{...body,expectedRevision:batch.revision}));await detail(batch.batchId,commit);
    }),
    configure:(branchId,body)=>execute(async commit=>{
      await read(await api.configureVendorOrderBranch(branchId,body));commit({access:await read(await api.getVendorOrderAccess()),batch:null,sheet:null,noteReviews:[]});
    }),
    mapping:body=>execute(async commit=>{
      await read(await api.configureVendorOrderMapping(state.selection.branchId,body));commit({access:await read(await api.getVendorOrderAccess()),batch:null,sheet:null,noteReviews:[]});
    }),
    grant:body=>execute(async commit=>{await read(await api.configureVendorOrderGrant(state.selection.branchId,body));commit({error:'分店授權已更新。'});}),
    dispose:()=>{disposed=true;generation++;lock=null;state=initial();listeners.clear();}
  };
  return flow;
};

import { requireIdentity } from '../http/authMiddleware.js';
import { jsonResponse } from '../http/response.js';
import { badRequest, notFound } from '../http/errors.js';
import { boundedText } from '../domain/vendorOrderPolicy.js';
import { forbidden } from '../http/errors.js';
import { configureVendorBranch,configureVendorMapping,configureVendorGrant,vendorOrderAccess,getVendorBranch,
  prepareVendorBatch,getVendorBatch,reviewVendorBatch,handoffVendorBatch,reportVendorBatch,listVendorBatches,getVendorHandoffSheet } from '../domain/vendorOrders.js';

const readJson=async request=>{
  // Bound configuration/review payloads; no arbitrary platform credentials.
  const raw=await request.text();
  if(raw.length>20000)throw badRequest('VENDOR_ORDER_BODY_TOO_LARGE');
  try{const value=JSON.parse(raw);if(!value||typeof value!=='object'||Array.isArray(value))throw new Error();return value;}
  catch{throw badRequest('INVALID_JSON');}
};
export const handleVendorOrderRoute=async(request,env,{fetchImpl=globalThis.fetch,now=new Date()}={})=>{
  const url=new URL(request.url);
  if(!url.pathname.startsWith('/api/vendor-orders/'))return null;
  const identity=await requireIdentity(request,env,{fetchImpl,now,allowViewAs:false});
  if(identity.actor.authMode!=='line'||!identity.actor.registered||!['Admin','ProxyAdmin'].includes(identity.actor.role))throw forbidden('VENDOR_ORDER_FORBIDDEN');
  const path=url.pathname.slice('/api/vendor-orders'.length);
  if(path==='/access'&&request.method==='GET')return jsonResponse(await vendorOrderAccess(env.DB,identity));
  if(path==='/batches'&&request.method==='POST')return jsonResponse(await prepareVendorBatch(env.DB,identity,await readJson(request),now));
  if(path==='/batches'&&request.method==='GET')return jsonResponse(await listVendorBatches(env.DB,identity,url.searchParams.get('branchId')));
  const branch=path.match(/^\/branches\/([^/]+)(?:\/(mappings|grants))?$/);
  if(branch){let id;try{id=boundedText(decodeURIComponent(branch[1]));}catch{throw badRequest('VENDOR_ORDER_INPUT_INVALID');}
    if(request.method==='GET'&&!branch[2])return jsonResponse(await getVendorBranch(env.DB,identity,id));
    if(request.method==='PUT'){
      const operation=branch[2]==='mappings'?configureVendorMapping:branch[2]==='grants'?configureVendorGrant:configureVendorBranch;
      return jsonResponse(await operation(env.DB,identity,id,await readJson(request),now));
    }
  }
  const batch=path.match(/^\/batches\/([^/]+)(?:\/(review|handoff|report|sheet))?$/);
  if(batch){const id=boundedText(batch[1]);
    if(request.method==='GET'&&!batch[2])return jsonResponse(await getVendorBatch(env.DB,identity,id,now));
    if(request.method==='GET'&&batch[2]==='sheet')return jsonResponse(await getVendorHandoffSheet(env.DB,identity,id));
    if(request.method==='POST'){
      const body=await readJson(request);
      if(batch[2]==='handoff')return jsonResponse(await handoffVendorBatch(env.DB,identity,id,body,request.headers.get('Idempotency-Key'),now));
      if(batch[2]==='review')return jsonResponse(await reviewVendorBatch(env.DB,identity,id,body,now));
      if(batch[2]==='report')return jsonResponse(await reportVendorBatch(env.DB,identity,id,body,now));
    }
  }
  throw notFound();
};

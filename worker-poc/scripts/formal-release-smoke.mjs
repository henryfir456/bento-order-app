import assert from 'node:assert/strict';
const base=process.env.BENTO_WORKER_BASE_URL;
if(!base || !/^https:\/\//.test(base)) throw new Error('BENTO_WORKER_BASE_URL must be an https URL');
const request=async (endpoint,init={})=>{
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),12000);
  try{return await fetch(new URL(endpoint,base),{...init,signal:controller.signal})}
  finally{clearTimeout(timer)}
};
const evidence=[];
for(const [path,status] of [['/api/health',200],['/api/me',401],['/api/orders/statistics',401]]) {
  const r=await request(path);
  evidence.push({path,status:r.status,expected:status});
  assert.equal(r.status,status,path);
}
const token=process.env.BENTO_SMOKE_ADMIN_TOKEN;
const subject=process.env.BENTO_SMOKE_VIEW_AS_USER_ID;
if(token || subject){
  if(!token || !subject)throw new Error('Both BENTO_SMOKE_ADMIN_TOKEN and BENTO_SMOKE_VIEW_AS_USER_ID required');
  const r=await request('/api/orders/statistics?period=all&viewAs='+encodeURIComponent(subject),{headers:{Authorization:'Bearer '+token}});
  evidence.push({path:'/api/orders/statistics?viewAs=<redacted>',status:r.status,expected:200});
  assert.equal(r.status,200,'authorized View As');
  const body=await r.json();
  assert.equal(body.success,true);
  assert.ok(Number.isFinite(Number(body.totalPortions)));
}
console.log(JSON.stringify({status:'PASS',evidence,authorizedViewAs:token?'PASS':'NOT_VERIFIED'},null,2));

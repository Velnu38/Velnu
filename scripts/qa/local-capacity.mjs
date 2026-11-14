import assert from 'node:assert/strict'
import {createHash,randomBytes,randomUUID} from 'node:crypto'
import {deflateSync} from 'node:zlib'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdir,writeFile} from 'node:fs/promises'
import {localApiOrigin} from './auth-storage-replay.mjs'
import {ownedReplayContainer,cleanupSyntheticFixture} from './synthetic-restore.mjs'
const exec=promisify(execFile),sleep=ms=>new Promise(r=>setTimeout(r,ms)),digest=b=>createHash('sha256').update(b).digest('hex')
export const CAPACITY_LIMITS=Object.freeze({tenants:300,phaseSeconds:90,soakSeconds:3600,requestCeiling:250000,requestsPerSecond:50,requestTimeoutMs:15000,p95Ms:1500,errorRate:0.01})
export function ownedRestContainer(projectId){ownedReplayContainer(projectId);return 'supabase_rest_'+projectId}
export function quantile(values,fraction){if(!values.length)return 0;const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.min(sorted.length-1,Math.max(0,Math.ceil(sorted.length*fraction)-1))]}
export function summarize(samples){const times=samples.map(s=>s.ms);return {requests:samples.length,errors:samples.filter(s=>!s.ok).length,p50Ms:Math.round(quantile(times,.5)),p95Ms:Math.round(quantile(times,.95)),p99Ms:Math.round(quantile(times,.99)),maxMs:Math.round(times.reduce((n,v)=>Math.max(n,v),0)),bytes:samples.reduce((n,s)=>n+s.bytes,0)}}
// A valid deterministic RGB PNG, about 0.75 MB; no external asset or customer file.
export function fixturePng(){
 const crc=bytes=>{let c=0xffffffff;for(const byte of bytes){c^=byte;for(let n=0;n<8;n++)c=(c>>>1)^((c&1)?0xedb88320:0)}return(c^0xffffffff)>>>0}
 const chunk=(name,data)=>{const type=Buffer.from(name),size=Buffer.alloc(4),tail=Buffer.alloc(4);size.writeUInt32BE(data.length);tail.writeUInt32BE(crc(Buffer.concat([type,data])));return Buffer.concat([size,type,data,tail])}
 const head=Buffer.alloc(13);head.writeUInt32BE(512,0);head.writeUInt32BE(512,4);head[8]=8;head[9]=2
 const raw=Buffer.alloc((512*3+1)*512);let seed=0x12345678;for(let y=0;y<512;y++)for(let x=1;x<=512*3;x++){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;raw[y*(512*3+1)+x]=seed&255}
 return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',head),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))])
}

export async function verifyLocalCapacity(db,status,{projectId}){
 const origin=localApiOrigin(status.API_URL),container=ownedRestContainer(projectId),dbContainer=ownedReplayContainer(projectId)
 assert.equal(db.connectionParameters.host,'127.0.0.1');assert.equal(Number(db.connectionParameters.port),54322)
 const clean=(await db.query("select (select count(*)::int from auth.users) users,(select count(*)::int from public.businesses) businesses,(select count(*)::int from storage.objects) files,current_setting('cron.launch_active_jobs') cron,not exists(select 1 from vault.secrets) empty_vault")).rows[0]
 assert.deepEqual(clean,{users:0,businesses:0,files:0,cron:'off',empty_vault:true})
 const actors=[],samples=[],phases=[],resources=[],png=fixturePng(),sha=digest(png),started=Date.now()
 let lastStart=0,rateTail=Promise.resolve(),inFlight=0,phasePeak=0
 async function pace(){const turn=rateTail.then(async()=>{await sleep(Math.max(0,lastStart+Math.ceil(1000/CAPACITY_LIMITS.requestsPerSecond)-Date.now()));lastStart=Date.now()});rateTail=turn.catch(()=>{});return turn}
 let report,requests=0,sequence=0,phase='seed',sample=false,recovery=false,expectedOutageErrors=0,refreshAt=Date.now()+20*60*1000
 async function api(path,token,{method='GET',body,raw,headers={},operation='setup',expectedStatus,expectedEmpty=false,expectedHash,expectedRows,expectedObject,allowOutage=false,teardown=false}={}){
  if(!path.startsWith('/')||path.startsWith('//')||++requests>CAPACITY_LIMITS.requestCeiling&&!teardown)throw Error('Capacity request boundary exceeded')
  const queued=performance.now();await pace();const pacingMs=performance.now()-queued
  const begin=performance.now();inFlight++;phasePeak=Math.max(phasePeak,inFlight);let bytes=0,ok=false
  try{
   const response=await fetch(origin+path,{method,redirect:'error',signal:AbortSignal.timeout(CAPACITY_LIMITS.requestTimeoutMs),headers:{apikey:status.ANON_KEY,Authorization:'Bearer '+token,...(body!==undefined?{'Content-Type':'application/json'}:{}),...headers},body:raw??(body===undefined?undefined:JSON.stringify(body))})
   const value=Buffer.from(await response.arrayBuffer());bytes=value.length
   if(expectedStatus!==undefined?response.status!==expectedStatus:!response.ok)throw Error('HTTP '+response.status)
   const json=value.length&&!expectedHash?JSON.parse(value.toString()):null
   if(expectedEmpty&&(!Array.isArray(json)||json.length))throw Error('Tenant isolation violation')
   if(expectedHash&&digest(value)!==expectedHash)throw Error('File integrity violation')
   if(expectedRows!==undefined&&(!Array.isArray(json)||json.length!==expectedRows))throw Error('Unexpected row count')
   if(expectedObject&&!expectedObject(json))throw Error('Unexpected scoped response')
   ok=true;return json
  }catch(error){
   // Only a deliberate owned REST restart may tolerate network/service errors.
   if(allowOutage&&recovery&&(/HTTP (502|503|504)/.test(error.message)||['TypeError','TimeoutError'].includes(error.name))){expectedOutageErrors++;return null}
   throw Error('Capacity '+operation+' failed: '+(/HTTP \d{3}/.test(error.message)?error.message:'assertion or transport'))
  }finally{inFlight--;if(sample)samples.push({operation,ms:performance.now()-begin,pacingMs,bytes,ok:ok||allowOutage&&recovery,phase})}
 }
 const rpc=(name,a,body,extra={})=>api('/rest/v1/rpc/'+name,a.token,{method:'POST',body,operation:name,...extra})
 const password=randomBytes(24).toString('base64url')
 try{
  // Real Auth users and password-issued JWTs; no locally forged business tokens.
  for(let index=0;index<CAPACITY_LIMITS.tenants;index++){
   const email='capacity-'+randomUUID()+'@example.test'
   const user=await api('/auth/v1/admin/users',status.SERVICE_ROLE_KEY,{method:'POST',body:{email,password,email_confirm:true}})
   const session=await api('/auth/v1/token?grant_type=password',status.ANON_KEY,{method:'POST',body:{email,password}})
   if(session.user?.id!==user.id||!session.access_token||!session.refresh_token)throw Error('Capacity Auth session mismatch')
   const a={id:user.id,business:randomUUID(),token:session.access_token,refresh:session.refresh_token,request:randomUUID(),customer:null,job:null,path:null,invoice:null,index};actors.push(a)
   await db.query('begin')
   try{
    await db.query("select set_config('request.jwt.claim.sub',$1,true)",[a.id])
    await db.query("insert into public.user_agreement_acceptances(user_id,agreement_version,terms_accepted,ai_disclosure_acknowledged,electronic_records_consent) values($1,'2026-11-06-v5',true,true,true)",[a.id])
    await db.query("insert into public.businesses(id,name,created_by_user_id) values($1,'Synthetic capacity business',$2)",[a.business,a.id])
    await db.query("insert into private.business_entitlements(business_id,plan) values($1,'pro') on conflict(business_id) do update set plan='pro',valid_until=null",[a.business])
    const customers=(await db.query("insert into public.customers(business_id,first_name,last_name,created_at) select $1,'Synthetic','Customer '||n,now()-(n||' months')::interval from generate_series(1,20)n returning id",[a.business])).rows
    a.customer=customers[0].id
    const jobs=(await db.query("insert into public.jobs(business_id,customer_id,title,status,created_at) select $1,$2,'Synthetic job '||n,case when n<=30 then 'completed' when n<=35 then 'in_progress' else 'lead' end,now()-(n||' days')::interval from generate_series(1,40)n returning id,status",[a.business,a.customer])).rows
    a.job=jobs.find(j=>j.status==='lead').id
    for(let n=0;n<20;n++){
     const invoice=(await db.query("insert into public.invoices(business_id,customer_id,issue_date,due_date) values($1,$2,current_date-($3::int*10),current_date-($3::int*10)+14) returning id",[a.business,customers[n].id,n])).rows[0]
     await db.query("insert into public.invoice_items(business_id,invoice_id,description,quantity,unit_price,tax_rate,sort_order) values($1,$2,'Synthetic labor',2,50,5,0),($1,$2,'Synthetic material',1,40,5,1)",[a.business,invoice.id])
     if(n%2===0)await db.query("update public.invoices set status='sent' where id=$1",[invoice.id])
     if(n%4===0)await db.query("select public.record_manual_payment($1,$2,$3,30,'cash','Synthetic capacity receipt')",[a.business,invoice.id,randomUUID()])
     if(n===0)a.invoice=invoice.id
    }
    await db.query('commit')
   }catch(error){await db.query('rollback');throw Error('Capacity seed transaction failed: '+(error.code||'unknown'))}
   const photo=await api('/rest/v1/record_photos',a.token,{method:'POST',headers:{Prefer:'return=representation'},body:{business_id:a.business,invoice_id:a.invoice,file_name:'synthetic-capacity.png',byte_size:png.length,media_type:'image/png'}})
   a.path=photo[0].storage_path
   await api('/rest/v1/rpc/reserve_attachment',status.SERVICE_ROLE_KEY,{method:'POST',body:{p_actor:a.id,p_bucket:'finviant-record-photos',p_path:a.path,p_bytes:png.length}})
   await api('/storage/v1/object/finviant-record-photos/'+a.path,status.SERVICE_ROLE_KEY,{method:'POST',raw:png,headers:{'Content-Type':'image/png'}})
   await api('/rest/v1/rpc/finish_attachment',status.SERVICE_ROLE_KEY,{method:'POST',body:{p_bucket:'finviant-record-photos',p_path:a.path}})
   if((index+1)%50===0)console.log(JSON.stringify({capacity:'seeding',workspaces:index+1}))
  }
  const population=(await db.query("select (select count(*)::int from public.businesses) businesses,(select count(*)::int from auth.users) sessions,(select count(*)::int from public.customers) customers,(select count(*)::int from public.jobs) jobs,(select count(*)::int from public.invoices) invoices,(select count(*)::int from public.payments) payments,(select count(*)::int from storage.objects) files")).rows[0]
  if(population.businesses!==300||population.sessions!==300||population.customers!==6000||population.jobs!==12000||population.invoices!==6000||population.payments!==1500||population.files!==300)throw Error('Capacity population incomplete')
  const queryPlans=[]
  const planShape=node=>Object.fromEntries(Object.entries(node).filter(([key])=>['Node Type','Index Name','Actual Rows','Actual Loops','Actual Total Time','Shared Hit Blocks','Shared Read Blocks','Planning Time','Execution Time','Plan','Plans'].includes(key)).map(([key,value])=>[key,Array.isArray(value)?value.map(planShape):value&&typeof value==='object'?planShape(value):value]))
  await db.query('begin')
  try{
   await db.query("select set_config('request.jwt.claim.sub',$1,true)",[actors[0].id]);await db.query('set local role authenticated')
   for(const [name,sql] of [['jobs_page','select id from public.jobs where business_id=$1 order by scheduled_start,id limit 25'],['customers_page','select id from public.customers where business_id=$1 order by id limit 25'],['open_invoices','select id,balance_due from public.invoices where business_id=$1 and balance_due>0 and status not in (\'draft\',\'void\') order by due_date,id limit 25']]){
    const r=await db.query('explain(analyze,buffers,format json) '+sql,[actors[0].business]);queryPlans.push({name,...planShape(r.rows[0]['QUERY PLAN'][0])})
   }
  }finally{await db.query('rollback')}
  const seedMilliseconds=Date.now()-started
  async function refreshSessions(){for(const a of actors){const s=await api('/auth/v1/token?grant_type=refresh_token',status.ANON_KEY,{method:'POST',body:{refresh_token:a.refresh},operation:'session_refresh'});if(s.user?.id!==a.id||!s.access_token)throw Error('Capacity refresh identity mismatch');a.token=s.access_token;a.refresh=s.refresh_token}refreshAt=Date.now()+20*60*1000}
  const invoiceBody=a=>({target_business_id:a.business,document_kind:'invoice',request_id:a.request,payload:{customer_id:a.customer,items:[{description:'Synthetic retry work',quantity:1,unit_price:100,tax_rate:5}]}})
  async function operation(a,n,allowOutage=false){
   const other=actors[(a.index+1)%actors.length],choice=(n+Math.floor(n/actors.length))%20,extra={allowOutage}
   if(choice<5)return rpc('get_job_directory_page',a,{p_business:a.business,p_filter:'all',p_page:n%2,p_search:''},{...extra,expectedObject:d=>d?.total===40&&d.items?.length<=25&&d.items.every(j=>j.customer_id===a.customer)})
   if(choice<9)return rpc('get_jobs_overview',a,{p_business:a.business},{...extra,expectedObject:d=>d?.counts?.all===40&&d.focus.length===4&&d.focus.every(j=>j.customer_id===a.customer)})
   if(choice<12)return api('/rest/v1/customers?select=id,business_id&business_id=eq.'+a.business,a.token,{...extra,operation:'customers',expectedRows:20,expectedObject:d=>d.every(row=>row.business_id===a.business)})
   if(choice<14)return api('/rest/v1/invoices?select=id,business_id,total,balance_due&business_id=eq.'+a.business+'&order=id&limit=25',a.token,{...extra,operation:'invoices',expectedObject:d=>Array.isArray(d)&&d.length>=20&&d.every(row=>row.business_id===a.business&&Number(row.balance_due)>=0)})
   if(choice===14)return api('/rest/v1/jobs?id=eq.'+a.job+'&business_id=eq.'+a.business,a.token,{...extra,operation:'save_job_notes',method:'PATCH',headers:{Prefer:'return=representation'},body:{description:'Synthetic manager update '+n},expectedRows:1,expectedObject:d=>d[0].id===a.job&&d[0].business_id===a.business})
   if(choice===15)return rpc('create_document',a,invoiceBody(a),{...extra,expectedObject:d=>!!d?.id&&Number(d.total)===105})
   if(choice===16)return api('/storage/v1/object/finviant-record-photos/'+a.path,a.token,{...extra,operation:'private_file',expectedHash:sha})
   if(choice===17)return api('/rest/v1/customers?select=id&business_id=eq.'+other.business,a.token,{...extra,operation:'foreign_read',expectedEmpty:true})
   if(choice===18)return rpc('get_jobs_overview',a,{p_business:other.business},{...extra,expectedStatus:403})
   return rpc('get_financial_overview',a,{p_business:a.business},{...extra,expectedObject:d=>!!d?.receivables&&Number(d.receivables.outstanding)>=0})
  }
  async function resourceSample(){
   const state=(await db.query("select (select count(*)::int from pg_stat_activity where datname=current_database()) connections,(select count(*)::int from pg_stat_activity where datname=current_database() and wait_event_type='Lock') lock_waiters,(select pg_database_size(current_database()))::text database_bytes,not exists(select 1 from private.tier_worker_config where enabled or endpoint is not null) delivery_disabled")).rows[0]
   if(!state.delivery_disabled)throw Error('Capacity sender boundary changed')
   const {stdout}=await exec('docker',['stats','--no-stream','--format','{{json .}}',dbContainer,container],{timeout:15000,maxBuffer:64000})
   const containers=stdout.trim().split('\n').map(line=>JSON.parse(line)).map(c=>({cpu:c.CPUPerc,memory:c.MemUsage,memoryPercent:c.MemPerc,pids:c.PIDs}))
   resources.push({elapsedSeconds:Math.round((Date.now()-started)/1000),...state,containers})
  }
  async function phaseRun(name,users,seconds,{allowOutage=false}={}){
   phase=name;sample=true;phasePeak=0;const offset=samples.length,deadline=Date.now()+seconds*1000,errors=[];let assigned=0,heartbeat=Date.now()+60000
   const workers=Array.from({length:users},async(_,slot)=>{while(Date.now()<deadline&&!errors.length){const begin=Date.now(),a=actors[(assigned++)%actors.length],n=sequence++;try{await operation(a,n,allowOutage)}catch(error){errors.push(error);break}await sleep(Math.max(0,Math.max(1000,users*1000/CAPACITY_LIMITS.requestsPerSecond)-(Date.now()-begin)))}})
   const monitor=(async()=>{while(Date.now()<deadline&&!errors.length){await sleep(Math.min(1000,Math.max(0,deadline-Date.now())));if(Date.now()>=heartbeat){heartbeat=Date.now()+60000;await resourceSample();console.log(JSON.stringify({capacity:name,elapsedSeconds:seconds-Math.ceil(Math.max(0,deadline-Date.now())/1000),summary:summarize(samples.slice(offset))}));if(Date.now()>=refreshAt)await refreshSessions()}}})()
   await Promise.all([...workers,monitor]);sample=false;if(errors.length)throw errors[0]
   const result={name,concurrentUsers:users,durationSeconds:seconds,peakHttpInFlight:phasePeak,p95PacingMs:Math.round(quantile(samples.slice(offset).map(s=>s.pacingMs),.95)),...summarize(samples.slice(offset))};phases.push(result)
   if(!allowOutage&&(result.errors/result.requests>CAPACITY_LIMITS.errorRate||result.p95Ms>CAPACITY_LIMITS.p95Ms))throw Error('Capacity acceptance threshold exceeded in '+name)
   console.log(JSON.stringify({capacity:'phase_complete',...result}));return result
  }
  await resourceSample()
  for(const users of [10,50,100])await phaseRun('ramp-'+users,users,CAPACITY_LIMITS.phaseSeconds)
  phase='recovery';recovery=true
  const recovering=phaseRun('owned-rest-restart',50,30,{allowOutage:true})
  recovering.catch(()=>{})
  await sleep(3000);const restartAt=performance.now();await exec('docker',['restart',container],{timeout:30000,maxBuffer:10000})
  let restored=false;for(let n=0;n<60;n++){try{await rpc('get_jobs_overview',actors[0],{p_business:actors[0].business},{expectedObject:d=>d?.counts?.all===40});restored=true;break}catch{await sleep(500)}}
  const recoveryMilliseconds=Math.ceil(performance.now()-restartAt);if(!restored)throw Error('Owned REST restart did not recover')
  await recovering;recovery=false
  // A deliberately discarded response must still create exactly one invoice.
  for(const a of actors.slice(0,10)){a.request=randomUUID();const first=await rpc('create_document',a,invoiceBody(a));const retry=await rpc('create_document',a,invoiceBody(a));if(first.id!==retry.id)throw Error('Recovery duplicated an invoice')}
  await phaseRun('soak',50,CAPACITY_LIMITS.soakSeconds)
  await resourceSample()
  const duplicates=(await db.query('select count(*)::int n from (select business_id,request_id from public.invoices where request_id is not null group by 1,2 having count(*)>1)x')).rows[0].n
  if(duplicates)throw Error('Capacity duplicate write found')
  const result={scope:'owned local Supabase Auth/PostgREST/PostgreSQL/Storage; not hosted production capacity',sourceCommit:process.env.GITHUB_SHA||null,population,queryPlans,sourceFileBytes:png.length,totalSourceBytes:png.length*300,seedMilliseconds,limits:CAPACITY_LIMITS,phases,recovery:{service:'owned PostgREST',milliseconds:recoveryMilliseconds,expectedOutageErrors,duplicateInvoices:duplicates},resources,totalRequests:requests,totalMilliseconds:Date.now()-started,externalProviderRequests:0,hostedProjectRequests:0,localAuthRateLimitOverride:true,limitations:['One standard CI runner hosts both clients and services.','No browser rendering, hosted Edge/SSR, external provider throughput or calendar delivery is measured.','Queue workers remain disabled; queue-lag acceptance is separate.']}
  report=result
 }catch(error){throw Error('Owned capacity test failed during '+phase+': '+error.message)}
 finally{
  sample=false
  for(const a of actors.filter(a=>a.path))await api('/storage/v1/object/finviant-record-photos',status.SERVICE_ROLE_KEY,{method:'DELETE',body:{prefixes:[a.path]},teardown:true}).catch(()=>{})
  await cleanupSyntheticFixture(db,{projectId,expectedUsers:actors.map(a=>a.id),expectedBusinesses:actors.map(a=>a.business)})
 }
 const after=(await db.query('select (select count(*)::int from auth.users) users,(select count(*)::int from public.businesses) businesses,(select count(*)::int from storage.objects) files')).rows[0]
 if(after.users||after.businesses||after.files)throw Error('Capacity cleanup did not complete')
 report.cleanup=after
 await mkdir('tmp/capacity-results',{recursive:true});await writeFile('tmp/capacity-results/result.json',JSON.stringify(report,null,2)+'\n')
 return report
}

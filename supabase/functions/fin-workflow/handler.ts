import {instructions,lookupSchema,replySchema,uiCatalog,uuid,validateLookup,validateReply,recordHref,type Lookup,type RecordSet} from './protocol.ts'
import {responseText} from '../fin-assistant/core.ts'
export type Session={profile:Record<string,unknown>;begin:(thread:string,request:string,text:string)=>Promise<{history:unknown[];cached:any}>;lookup:(query:Lookup)=>Promise<RecordSet>;finish:(thread:string,request:string,reply:unknown)=>Promise<any>;reserve:()=>Promise<void>}
export type Dependencies={authorize:(authorization:string,business:string)=>Promise<Session|null>;complete:(input:unknown[],tools:unknown[],instructions:string,schema:unknown,timeoutMs?:number)=>Promise<any>}
const headers={'content-type':'application/json','cache-control':'no-store','access-control-allow-origin':'*','access-control-allow-headers':'authorization,apikey,x-client-info,content-type','access-control-allow-methods':'POST,OPTIONS'}
export function workflowHandler(deps:Dependencies){return async(req:Request)=>{
 const send=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers})
 if(req.method==='OPTIONS')return send(200,{})
 if(req.method!=='POST')return send(405,{error:'Method not allowed'})
 const auth=req.headers.get('authorization')||'';if(!auth.startsWith('Bearer '))return send(401,{error:'Sign in to ask Fin.'})
 try{
  if(Number(req.headers.get('content-length')||0)>16000)return send(413,{error:'Keep the request under 6,001 characters.'})
  const raw=await req.text();if(raw.length>16000)return send(413,{error:'Request too long.'})
  let body;try{body=JSON.parse(raw)}catch{return send(400,{error:'Invalid request.'})}
  if(!body||!uuid.test(body.business_id)||!uuid.test(body.thread_id)||!uuid.test(body.request_id)||typeof body.text!=='string'||body.text.trim().length<1||body.text.length>6000||Object.keys(body).some(k=>!['business_id','thread_id','request_id','text'].includes(k)))return send(400,{error:'A valid account, conversation and request are required.'})
  const session=await deps.authorize(auth,body.business_id);if(!session)return send(403,{error:'Your account or role does not allow this request.'})
  const previous=await session.begin(body.thread_id,body.request_id,body.text.trim());if(previous.cached)return send(200,previous.cached)
  const timezone=String(session.profile.timezone||'America/New_York');const asOf=new Date().toISOString()
  const input:any[]=[{role:'user',content:JSON.stringify({active_account:session.profile,as_of:asOf,local_time:new Intl.DateTimeFormat('en-US',{timeZone:timezone,dateStyle:'full',timeStyle:'long'}).format(new Date()),timezone,ui_catalog:uiCatalog,prior_conversation:previous.history,request:body.text.trim()})}]
  const sets:RecordSet[]=[];let searches=0;const deadline=Date.now()+125000
  const lookupTool={type:'function',name:'lookup_account_records',description:'Search only the authorized active account. Exact IDs, customer scope, names/numbers, date range and oldest/newest/due order. Returns 25 rows with exact whole-filter counts and monetary sums. Query a specific invoice/estimate ID to include all saved line items. Use status unpaid for issued, non-void invoices with a balance. Dates use inclusive from and exclusive to. NULL means no filter.',strict:true,parameters:lookupSchema}
  for(let round=0;round<5;round++){
   if(JSON.stringify(input).length>300000)throw Error('These records are too large to review together. Narrow the request to one customer, document or date range.')
   const remaining=deadline-Date.now();if(remaining<5000)throw Error('Fin needs a narrower request to finish reliably. Your words are preserved.')
   await session.reserve()
   const output=await deps.complete(input,round<4&&searches<8?[lookupTool]:[],instructions,replySchema,Math.min(45000,remaining))
   const calls=(output?.output||[]).filter((i:any)=>i.type==='function_call')
   if(calls.length){
    if(round===4||calls.length+searches>8)return send(422,{error:'This request needs a narrower record search. Specify the customer, date range or record number.'})
    // Preserve provider reasoning items but never accept another model-selected tool.
    input.push(...output.output)
    for(const call of calls){
     if(call.name!=='lookup_account_records')throw Error('Fin requested an unsupported tool.')
     let q;try{q=JSON.parse(call.arguments)}catch{throw Error('Fin could not prepare a valid record lookup.')}
     if(!validateLookup(q))throw Error('Fin could not prepare a valid record lookup.')
     searches++
     const found=await session.lookup(q)
     if(found.resource!==q.resource||!Array.isArray(found.rows)||found.rows.some(r=>!uuid.test(r.id)))throw Error('Record lookup returned invalid data.')
     sets.push(found);input.push({type:'function_call_output',call_id:call.call_id,output:JSON.stringify(found)})
    }
    continue
   }
   let parsed;try{parsed=JSON.parse(responseText(output))}catch{throw Error('Fin could not prepare a complete response. Please try again.')}
   const reply=validateReply(parsed,sets,[...previous.history.map((h:any)=>typeof h?.request==='string'?h.request:''),body.text.trim()],Number(session.profile.default_tax_rate||0))
   const sources=reply.source_keys.map(key=>{if(key==='profile')return {key,label:'Saved company profile',href:'/?view=settings'};const [resource,id]=key.split(':');const row=sets.find(s=>s.resource===resource&&s.rows.some(r=>r.id===id))?.rows.find(r=>r.id===id);return {key,label:String(row?.invoice_number||row?.estimate_number||row?.title||row?.note||[row?.first_name,row?.last_name].filter(Boolean).join(' ')||row?.company||key),href:recordHref(key)}})
   const limits=sets.map(s=>`${s.resource.replaceAll('_',' ')}: ${s.rows.length} shown of ${s.matching_count} matching records; ${s.complete&&s.offset===0?'complete list':'partial list'}. Aggregates cover the entire matching set.`)
   const saved=await session.finish(body.thread_id,body.request_id,{...reply,sources,limits,as_of:asOf,timezone})
   return send(200,saved)
  }
  return send(422,{error:'Please narrow this request.'})
 }catch(error){
  const code=(error as {code?:string})?.code
  if(code==='42501')return send(403,{error:'Your account or module access changed. No changes were saved.'})
  if(code==='40001'||code==='23505')return send(409,{error:'The conversation or a record changed. Ask Fin to prepare a fresh review.'})
  if(code==='P0001')return send(429,{error:'Fin could not complete this request. Check the details or try again later.'})
  // No database write to business records occurs in this endpoint.
  return send(503,{error:error instanceof Error&&!code?error.message:'Fin could not retrieve or verify this request. No business records were changed.'})
 }
}}

import {readLimitedRequest} from '../_shared/signedEvents.ts'
import {archiveHash} from '../../../shared/archiveZip.ts'
import {assembleArchivePart,type ArchiveClaim} from './assemble.ts'
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
type Result={data:any;error?:any}
export type ArchiveDependencies={origins:readonly string[];authorize:(auth:string)=>Promise<string|null>;caller:(auth:string,name:string,args:Record<string,unknown>)=>Promise<Result>;source:(file:Record<string,unknown>)=>Promise<Uint8Array>;save:(path:string,bytes:Uint8Array)=>Promise<void>;finish:(claim:ArchiveClaim,result:{sha256:string;bytes:Uint8Array;entries:unknown[]})=>Promise<void>;download:(path:string)=>Promise<Uint8Array>}
export function ownerArchiveHandler(deps:ArchiveDependencies){return async(req:Request)=>{
 const origin=req.headers.get('origin')||'',headers:Record<string,string>={'cache-control':'private, no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','vary':'Origin','access-control-allow-methods':'POST,OPTIONS','access-control-allow-headers':'authorization,apikey,content-type,x-client-info','access-control-expose-headers':'Content-Disposition,X-Archive-SHA256',...(deps.origins.includes(origin)?{'access-control-allow-origin':origin}:{})}
 const reply=(status:number,value:unknown)=>new Response(JSON.stringify(value),{status,headers:{...headers,'content-type':'application/json'}})
 if(origin&&!deps.origins.includes(origin))return reply(403,{error:'Unauthorized app address.'})
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers})
 if(req.method!=='POST')return reply(405,{error:'Use POST.'})
 try{
  let input:any;try{input=JSON.parse(await readLimitedRequest(req,2048))}catch{return reply(400,{error:'Invalid archive request.'})}
  if(!input||!UUID.test(input.business_id)||!UUID.test(input.archive_id)||!['prepare','download'].includes(input.action))return reply(400,{error:'Choose an archive.'})
  const auth=req.headers.get('authorization')||'';if(!auth.startsWith('Bearer ')||!await deps.authorize(auth))return reply(401,{error:'Sign in to your owner account.'})
  if(input.action==='download'){
   if(!Number.isInteger(input.part)||input.part<1)return reply(400,{error:'Choose an archive part.'})
   const {data,error}=await deps.caller(auth,'owner_archive_download',{p_business:input.business_id,p_archive:input.archive_id,p_part:input.part})
   const path=input.business_id+'/'+input.archive_id+'/'+input.part+'.zip'
   if(error||!data||data.path!==path||!/^[a-f0-9]{64}$/.test(data.sha256))return reply(403,{error:'Archive unavailable, incomplete, or expired.'})
   const bytes=await deps.download(path);if(bytes.length!==data.byte_size||await archiveHash(bytes)!==data.sha256)throw Error('Archive integrity check failed')
   const copy=new Uint8Array(bytes.length);copy.set(bytes)
   return new Response(copy.buffer,{status:200,headers:{...headers,'content-type':'application/zip','content-disposition':`attachment; filename="Finviant-${input.archive_id}-part-${input.part}.zip"`,'x-archive-sha256':data.sha256}})
  }
  const {data,error}=await deps.caller(auth,'claim_owner_archive_part',{p_business:input.business_id,p_archive:input.archive_id})
  if(error||!data)return reply(403,{error:'Archive unavailable or expired. Only its current primary owner can prepare it.'})
  if(data.ready||data.busy)return reply(200,{ready:data.ready===true,busy:data.busy===true})
  if(data.archive_id!==input.archive_id||data.business_id!==input.business_id)throw Error('Archive scope mismatch')
  const result=await assembleArchivePart(data,deps.source)
  if(Date.parse(data.expires_at)<=Date.now())return reply(410,{error:'This archive expired. Request a new archive.'})
  const path=data.business_id+'/'+data.archive_id+'/'+data.part_no+'.zip'
  await deps.save(path,result.bytes);await deps.finish(data,result)
  return reply(200,{prepared_part:data.part_no})
 }catch{return reply(503,{error:'The archive could not be verified. Your original records are unchanged. Wait two minutes and resume; if a source file changed, request a new archive.'})}
}}

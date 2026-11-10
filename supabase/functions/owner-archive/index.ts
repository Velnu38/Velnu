import {createClient} from 'npm:@supabase/supabase-js@2.57.4'
import {resolveAppEnvironment} from '../_shared/appEnvironment.ts'
import {ownerArchiveHandler} from './handler.ts'
const url=Deno.env.get('SUPABASE_URL')||'',anon=Deno.env.get('SUPABASE_ANON_KEY')||'',key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'',env=resolveAppEnvironment(url,Deno.env.get('FINVIANT_APP_BASE_URL'))
const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}}),client=(auth:string)=>createClient(url,anon,{global:{headers:{Authorization:auth}},auth:{persistSession:false,autoRefreshToken:false}})
const bucket='finviant-owner-archives'
Deno.serve(!env?()=>new Response('Archive service unavailable',{status:503}):ownerArchiveHandler({origins:env.origins,
 authorize:async auth=>{const {data,error}=await client(auth).auth.getUser();return error?null:data.user?.id||null},
 caller:async(auth,name,args)=>await client(auth).rpc(name,args).abortSignal(AbortSignal.timeout(15000)),
 source:async file=>{
  const check=()=>admin.rpc('validate_owner_archive_source',{p_bucket:file.bucket,p_path:file.path,p_updated_at:file.updated_at,p_bytes:file.byte_size}).abortSignal(AbortSignal.timeout(5000))
  const before=await check();if(before.error||before.data!==true)throw Error('Source file changed')
  const {data,error}=await admin.storage.from(String(file.bucket)).download(String(file.path));if(error||!data||data.size!==file.byte_size||data.size>10000000)throw Error('Source file unavailable')
  const bytes=new Uint8Array(await data.arrayBuffer()),after=await check();if(after.error||after.data!==true)throw Error('Source file changed')
  return bytes
 },
 save:async(path,bytes)=>{const {error}=await admin.storage.from(bucket).upload(path,bytes,{contentType:'application/zip',cacheControl:'0',upsert:true});if(error)throw Error('Archive upload unconfirmed')},
 finish:async(claim,result)=>{const {error}=await admin.rpc('finish_owner_archive_part',{p_archive:claim.archive_id,p_part:claim.part_no,p_lease:claim.lease,p_sha256:result.sha256,p_bytes:result.bytes.length,p_entries:result.entries});if(error)throw Error('Archive registration unconfirmed')},
 download:async path=>{const {data,error}=await admin.storage.from(bucket).download(path);if(error||!data||data.size>24000000)throw Error('Archive unavailable');return new Uint8Array(await data.arrayBuffer())}
}))

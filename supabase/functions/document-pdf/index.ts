import {currentSessionActor} from '../_shared/currentSession.ts'
import {createClient} from 'npm:@supabase/supabase-js@2.57.4'
import {documentPdfHandler} from './handler.ts'
import {ensureStoredDocumentPdf} from '../_shared/documentPdfArtifact.ts'
import {resolveAppEnvironment} from '../_shared/appEnvironment.ts'

const url=Deno.env.get('SUPABASE_URL')||'',anon=Deno.env.get('SUPABASE_ANON_KEY')||'',service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||''
const environment=resolveAppEnvironment(url,Deno.env.get('FINVIANT_APP_BASE_URL'))
if(!environment||!anon||!service){
 Deno.serve(()=>new Response(JSON.stringify({error:'Document service is not configured.'}),{status:503,headers:{'content-type':'application/json','cache-control':'no-store'}}))
}else{
 const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}})
 const caller=(authorization:string)=>createClient(url,anon,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}})
 Deno.serve(documentPdfHandler({
  origins:environment.origins,
  authorize:authorization=>currentSessionActor(caller(authorization)),
  ownerVersion:async(authorization,business,kind,document)=>await caller(authorization).rpc('get_owner_document_version',{p_business:business,p_kind:kind,p_document:document}).abortSignal(AbortSignal.timeout(8000)),
  customerVersion:async(token,type)=>await admin.rpc('get_document_pdf_version',{p_token:token,p_token_type:type}).abortSignal(AbortSignal.timeout(8000)),
  artifact:versionId=>ensureStoredDocumentPdf(admin,versionId),
 }))
}

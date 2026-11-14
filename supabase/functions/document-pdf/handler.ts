import { burstLimitResponse } from '../_shared/burstLimit.ts'
import { readLimitedRequest } from '../_shared/signedEvents.ts'

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TOKEN=/^[a-f0-9]{64}$/
type Artifact={bytes:Uint8Array;sha256:string;filename:string;versionId:string}
type Result={data:unknown;error?:unknown}
export type PdfHandlerDependencies={
  origins:readonly string[]
  authorize:(authorization:string)=>Promise<string|null>
  ownerVersion:(authorization:string,business:string,kind:string,document:string)=>Promise<Result>
  customerVersion:(token:string,type:'document_share'|'approval')=>Promise<Result>
  artifact:(versionId:string)=>Promise<Artifact>
}
export function documentPdfHandler(deps:PdfHandlerDependencies){
 return async(req:Request):Promise<Response>=>{
  const origin=req.headers.get('origin')||''
  const headers:Record<string,string>={'cache-control':'private, no-store, max-age=0','x-content-type-options':'nosniff','x-robots-tag':'noindex, nofollow','referrer-policy':'no-referrer','vary':'Origin',
   ...(deps.origins.includes(origin)?{'access-control-allow-origin':origin}:{}),
   'access-control-allow-headers':'authorization, apikey, content-type, x-client-info','access-control-allow-methods':'POST, OPTIONS',
   'access-control-expose-headers':'Content-Disposition, ETag, X-Finviant-Revision-Id'}
  const reply=(status:number,error:string)=>new Response(JSON.stringify({error}),{status,headers:{...headers,'content-type':'application/json'}})
  if(origin&&!deps.origins.includes(origin))return reply(403,'This app address is not authorized.')
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers})
  if(req.method!=='POST')return reply(405,'Use POST to open a document PDF.')
  try{
   let input:Record<string,unknown>
   try{input=JSON.parse(await readLimitedRequest(req,4096))}catch{return reply(400,'Invalid PDF request.')}
   if(!input||typeof input!=='object'||Array.isArray(input))return reply(400,'Invalid PDF request.')
   let result:Result
   if(input.token!==undefined){
    if(typeof input.token!=='string'||!TOKEN.test(input.token)||!['share','approval','document_share'].includes(String(input.token_type||'share')))return reply(400,'Invalid document link.')
    result=await deps.customerVersion(input.token,input.token_type==='approval'?'approval':'document_share')
   }else{
    const business=String(input.business_id||''),kind=String(input.document_kind||''),document=String(input.document_id||'')
    if(!UUID.test(business)||!UUID.test(document)||!['invoice','estimate','change_order'].includes(kind))return reply(400,'Choose a saved invoice, estimate, or change order.')
    const authorization=req.headers.get('authorization')||''
    if(!authorization.startsWith('Bearer ')||!await deps.authorize(authorization))return reply(401,'Sign in to open this document.')
    result=await deps.ownerVersion(authorization,business,kind,document)
   }
   const limited=burstLimitResponse(result.error,headers);if(limited)return limited
   const version=result.data as {version_id?:unknown}|null
   if(result.error||!version||typeof version.version_id!=='string'||!UUID.test(version.version_id))return reply(404,'This document is unavailable or this link has been revoked.')
   const artifact=await deps.artifact(version.version_id)
   if(artifact.versionId!==version.version_id||!artifact.bytes.length||!/^[a-f0-9]{64}$/.test(artifact.sha256)||!/^[-A-Za-z0-9_.]{1,120}\.pdf$/.test(artifact.filename))return reply(503,'The saved PDF could not be verified. Try again.')
   const bytes=new Uint8Array(artifact.bytes.length);bytes.set(artifact.bytes)
   return new Response(bytes.buffer,{status:200,headers:{...headers,'content-type':'application/pdf','content-disposition':`inline; filename="${artifact.filename}"`,'etag':'"'+artifact.sha256+'"','x-finviant-revision-id':artifact.versionId}})
  }catch(error){
   const limited=burstLimitResponse(error,headers);if(limited)return limited
   const code=error instanceof Error?error.message:''
   if(code==='PDF_STORAGE_ALLOWANCE_REACHED')return reply(409,'The business storage allowance is full. Existing saved PDFs remain available; the business needs to free space or upgrade before publishing another PDF.')
   if(/The document font cannot display U\+[0-9A-F]+/.test(code))return reply(409,'This document contains a character the PDF font cannot display. The business needs to review the document text before sending.')
   if(code==='DOCUMENT_LOGO_FORMAT_UNSUPPORTED')return reply(409,'This business logo cannot be included in a PDF yet. The business can upload a PNG or JPG logo and publish a new document version.')
   return reply(503,'The saved document PDF could not be opened. Try again; the document has not been changed.')
  }
 }
}

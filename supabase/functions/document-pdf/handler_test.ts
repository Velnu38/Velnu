import {documentPdfHandler} from './handler.ts'
const B='11111111-1111-4111-8111-111111111111',D='22222222-2222-4222-8222-222222222222',V='33333333-3333-4333-8333-333333333333'
function assert(value:unknown,message='Assertion failed'):asserts value{if(!value)throw new Error(message)}
function fixture(options:{signedIn?:boolean;unavailable?:boolean;badArtifact?:boolean;artifactError?:string}={}){
 const calls:string[]=[]
 const handler=documentPdfHandler({origins:['https://finviant.com'],
  authorize:async()=>{calls.push('auth');return options.signedIn===false?null:'owner'},
  ownerVersion:async(header,business,kind,document)=>{calls.push('owner');assert(header==='Bearer owner-token');assert(business===B&&kind==='invoice'&&document===D);return options.unavailable?{data:null,error:{}}:{data:{version_id:V}}},
  customerVersion:async(token,type)=>{calls.push('customer:'+type);assert(token==='ab'.repeat(32));return options.unavailable?{data:null,error:{}}:{data:{version_id:V}}},
  artifact:async version=>{calls.push('artifact');assert(version===V);if(options.artifactError)throw new Error(options.artifactError);return{bytes:new TextEncoder().encode('%PDF-1.7 saved document'),sha256:'a'.repeat(64),filename:options.badArtifact?'malicious\r\n.pdf':'Invoice-100.pdf',versionId:V}},
 })
 const request=(input:unknown,authorization='Bearer owner-token',origin='https://finviant.com')=>new Request('https://project.supabase.co/functions/v1/document-pdf',{method:'POST',headers:{origin,authorization,'content-type':'application/json'},body:JSON.stringify(input)})
 return{handler,calls,request}
}
Deno.test('owner PDF requires verified JWT and scoped publication RPC before artifact access',async()=>{
 const f=fixture();const r=await f.handler(f.request({business_id:B,document_kind:'invoice',document_id:D}))
 assert(r.status===200);assert(f.calls.join(',')==='auth,owner,artifact')
 assert(r.headers.get('content-type')==='application/pdf');assert(r.headers.get('x-finviant-revision-id')===V)
 assert(r.headers.get('cache-control')?.includes('no-store'));assert(r.headers.get('access-control-expose-headers')?.includes('X-Finviant-Revision-Id'))
 assert((await r.text()).startsWith('%PDF-'))
})
Deno.test('expired owner JWT never reaches artifact retrieval',async()=>{
 const f=fixture({signedIn:false});assert((await f.handler(f.request({business_id:B,document_kind:'invoice',document_id:D}))).status===401)
 assert(f.calls.join(',')==='auth')
})
Deno.test('anonymous document and approval tokens resolve only their allowed version',async()=>{
 for(const type of ['share','approval']){
  const f=fixture();const r=await f.handler(f.request({token:'ab'.repeat(32),token_type:type},''))
  assert(r.status===200);assert(f.calls.join(',')===`customer:${type==='share'?'document_share':'approval'},artifact`)
 }
})
Deno.test('revoked or unknown token never reaches private artifact access',async()=>{
 const f=fixture({unavailable:true});const r=await f.handler(f.request({token:'ab'.repeat(32)},''))
 assert(r.status===404);assert(f.calls.join(',')==='customer:document_share')
})
Deno.test('malformed token, owner ID, method and unapproved origin reject before dependencies',async()=>{
 for(const data of [{token:'guess'},{token:'ab'.repeat(32),token_type:'all-business-documents'},{business_id:B,document_kind:'invoice',document_id:'guess'}]){
  const f=fixture();assert((await f.handler(f.request(data))).status===400);assert(!f.calls.length)
 }
 const f=fixture();assert((await f.handler(f.request({token:'ab'.repeat(32)},'','https://attacker.invalid'))).status===403);assert(!f.calls.length)
 assert((await f.handler(new Request('https://project.supabase.co/functions/v1/document-pdf'))).status===405)
})
Deno.test('invalid artifact or unsupported logo never produces a successful PDF response',async()=>{
 const f=fixture({badArtifact:true});assert((await f.handler(f.request({token:'ab'.repeat(32)},''))).status===503)
 const g=fixture({artifactError:'DOCUMENT_LOGO_FORMAT_UNSUPPORTED'});const r=await g.handler(g.request({token:'ab'.repeat(32)},''));assert(r.status===409);assert((await r.text()).includes('PNG or JPG'))
})

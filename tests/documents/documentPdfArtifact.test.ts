import assert from 'node:assert/strict'
import test from 'node:test'
import {documentPdfPath,documentPdfFilename,ensureStoredDocumentPdf,pdfSha256,pdfBase64,prepareQueuedDocumentPdf} from '../../supabase/functions/_shared/documentPdfArtifact.ts'

const B='11111111-1111-4111-8111-111111111111',D='22222222-2222-4222-8222-222222222222',V='33333333-3333-4333-8333-333333333333'
const snapshot={kind:'invoice' as const,number:'INV-101',revision_created_at:'2026-11-07T12:00:00Z',issue_date:'2026-11-07',subtotal:100,tax_amount:0,total:100,company:{name:'Test Business'},customer:{name:'Test Customer'},items:[{description:'Work completed',quantity:1,unit_price:100,line_total:100}]}
function store(options:{cached?:Uint8Array;expectedHash?:string;logo?:string;saveFails?:boolean;freezeFails?:boolean}={}){
 const version={version_id:V,business_id:B,kind:'invoice',document_id:D,snapshot:{...snapshot,company:{...snapshot.company,...(options.logo?{logo_path:options.logo}:{})}},pdf_sha256:options.expectedHash}
 const objects=new Map<string,Uint8Array>(),calls:{name:string;args:any}[]=[]
 const path=documentPdfPath(version as any)
 if(options.cached)objects.set('finviant-document-pdfs/'+path,options.cached)
 const client={
  rpc(name:string,args:any){
   calls.push({name,args});let result:any
   if(name==='document_pdf_artifact_context')result={data:version,error:null}
   else if(name==='reserve_document_pdf_artifact')result={data:null,error:null}
   else if(name==='register_document_pdf_artifact')result={data:{ok:true},error:null}
   else if(name==='freeze_document_email_attachment')result=options.freezeFails?{data:null,error:{message:'acknowledgement failed'}}:{data:{to:['customer@example.test'],attachments:[{filename:args.p_filename,content:args.p_content,content_type:'application/pdf'}]},error:null}
   else throw new Error('Unexpected RPC '+name)
   return {abortSignal:async()=>result}
  },
  storage:{from(bucket:string){return{
   download:async(key:string)=>{const bytes=objects.get(bucket+'/'+key);return bytes?{data:new Blob([new Uint8Array(bytes).buffer]),error:null}:{data:null,error:{message:'not found'}}},
   upload:async(key:string,bytes:Uint8Array,settings:any)=>{assert.equal(settings.upsert,false);assert.equal(bucket,'finviant-document-pdfs');if(options.saveFails)return{error:{message:'storage failed'}};assert.ok(!objects.has(bucket+'/'+key));objects.set(bucket+'/'+key,new Uint8Array(bytes));return{error:null}},
  }}},
 }
 return{client:client as any,objects,calls,version,path}
}

test('all viewers and delivery use the same saved immutable PDF bytes',async()=>{
 const f=store()
 const first=await ensureStoredDocumentPdf(f.client,V),again=await ensureStoredDocumentPdf(f.client,V)
 assert.ok(new TextDecoder().decode(first.bytes.subarray(0,5)).startsWith('%PDF-'))
 assert.deepEqual(first.bytes,again.bytes)
 assert.equal(first.sha256,await pdfSha256(first.bytes))
 assert.equal(first.filename,'Invoice-INV-101.pdf')
 assert.equal(f.objects.size,1)
 const payload=await prepareQueuedDocumentPdf(f.client,{id:D,lease:B,document_version_id:V,payload:{to:['customer@example.test']}})
 assert.equal((payload.attachments as any[])[0].content,pdfBase64(first.bytes))
 assert.equal(f.calls.filter(call=>call.name==='freeze_document_email_attachment').length,1)
})

test('a cached object with changed bytes fails closed and is never regenerated or overwritten',async()=>{
 const bytes=new TextEncoder().encode('%PDF-1.7 altered object'),f=store({cached:bytes,expectedHash:'a'.repeat(64)})
 await assert.rejects(()=>ensureStoredDocumentPdf(f.client,V),/DOCUMENT_PDF_INTEGRITY_FAILED/)
 assert.equal(f.calls.length,1)
 assert.deepEqual(f.objects.values().next().value,bytes)
})

test('storage failure and unknown attachment freeze acknowledgement never produce a sendable payload',async()=>{
 const failed=store({saveFails:true})
 await assert.rejects(()=>ensureStoredDocumentPdf(failed.client,V),/DOCUMENT_PDF_SAVE_UNCONFIRMED/)
 assert.ok(!failed.calls.some(call=>call.name==='register_document_pdf_artifact'))
 const uncertain=store({cached:new TextEncoder().encode('%PDF-1.7 cached original'),freezeFails:true})
 await assert.rejects(()=>prepareQueuedDocumentPdf(uncertain.client,{id:D,lease:B,document_version_id:V,payload:{}}),/DOCUMENT_PDF_PAYLOAD_NOT_FROZEN/)
})

test('logo paths outside the document business and unsafe filenames are never fetched',async()=>{
 const f=store({logo:'44444444-4444-4444-8444-444444444444/logo.png'})
 await assert.rejects(()=>ensureStoredDocumentPdf(f.client,V),/INVALID_DOCUMENT_LOGO_PATH/)
 assert.equal(f.objects.size,0)
 assert.equal(documentPdfFilename({kind:'change_order',number:'../../unsafe\r\nname'}),'Change-order-unsafe--name.pdf')
 assert.throws(()=>documentPdfPath({...f.version,business_id:'../other'} as any),/INVALID_DOCUMENT_VERSION/)
})

test('already frozen retry payload and legacy operations retain their original provider content',async()=>{
 const f=store(),payload={to:['customer@example.test'],attachments:[{filename:'Original.pdf',content:'immutable'}]}
 assert.equal(await prepareQueuedDocumentPdf(f.client,{id:D,lease:B,document_version_id:V,payload}),payload)
 const legacy={to:['customer@example.test'],text:'Legacy originally queued text'}
 assert.equal(await prepareQueuedDocumentPdf(f.client,{id:D,lease:B,payload:legacy}),legacy)
 assert.equal(f.calls.length,0)
})

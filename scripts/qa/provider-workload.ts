import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {mkdir,writeFile} from 'node:fs/promises'
import {PDFDocument} from 'pdf-lib'
import {generateDocumentPdf} from '../../shared/documentPdf.ts'
import {documentPdfFixture} from '../../tests/documents/pdf-fixtures.ts'
import {workflowHandler} from '../../supabase/functions/fin-workflow/handler.ts'
import {receiptScanHandler} from '../../supabase/functions/receipt-scan/handler.ts'

// Actual PDF renderer and HTTP handlers; identity/quota/provider dependencies are simulated.
// No hosted URLs, secrets, customer records, paid API calls or external fetches.
const originalFetch=globalThis.fetch
let networkAttempts=0
const denyFetch:typeof fetch=async()=>{networkAttempts++;throw Error('External network is forbidden in the isolated workload')}
globalThis.fetch=denyFetch
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms))
const phases:any[]=[],started=Date.now()
let requests=0,pdfBytes=0,aiCalls=0,ocrCalls=0,peakProviders=0,activeProviders=0,peakRss=process.memoryUsage().rss
async function provider<T>(value:T){activeProviders++;peakProviders=Math.max(peakProviders,activeProviders);try{await sleep(10);return value}finally{activeProviders--}}
try{
 for(const clients of [10,50,100]){
  const times:number[]=[],begin=performance.now();let cursor=0
  await Promise.all(Array.from({length:clients},async()=>{
   while(cursor<100){
    const index=cursor++,business=randomUUID(),actor=randomUUID(),thread=randomUUID(),request=randomUUID(),label=`Synthetic ${clients}-${index}`
    const at=performance.now();let reserves=0,saves=0
    const fin=workflowHandler({authorize:async(auth,b)=>auth==='Bearer '+actor&&b===business?{profile:{name:label,timezone:'UTC'},begin:async()=>({history:[],cached:null}),lookup:async()=>{throw Error('Unexpected lookup')},reserve:async()=>{reserves++},finish:async(_t,_r,reply)=>{saves++;return reply}}:null,
     complete:async(input)=>{aiCalls++;const context=JSON.parse((input[0] as any).content);assert.equal(context.active_account.name,label);return provider({output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({answer:label,source_keys:['profile'],navigation:[],clarification:null,steps:[]})}]}]})}})
    const receipt=receiptScanHandler({origins:[],authorize:async bearer=>bearer===actor?actor:null,reserve:async(b,_r,u)=>{assert.equal(b,business);assert.equal(u,actor);return {error:null}},analyze:async bytes=>{ocrCalls++;assert.equal(bytes.length,786432);return provider({ExpenseDocuments:[{SummaryFields:[{Type:{Text:'VENDOR_NAME'},ValueDetection:{Text:label,Confidence:99}},{Type:{Text:'TOTAL'},ValueDetection:{Text:'105.25',Confidence:99},Currency:{Code:'USD'}},{Type:{Text:'INVOICE_RECEIPT_DATE'},ValueDetection:{Text:'2026-11-10',Confidence:99}}]}]})}})
    const image=new Uint8Array(786432);image.set([255,216,255,217])
    const snapshot=documentPdfFixture(index%2?'invoice':'estimate');snapshot.document_id=business;snapshot.revision_id=randomUUID();snapshot.number=`SYN-${clients}-${index}`;snapshot.company.name=label
    const [a,o,pdf]=await Promise.all([
     fin(new Request('https://local.test',{method:'POST',headers:{authorization:'Bearer '+actor,'content-type':'application/json'},body:JSON.stringify({business_id:business,thread_id:thread,request_id:request,text:'What is my saved business name?'})})),
     receipt(new Request(`https://local.test?business=${business}&request=${request}`,{method:'POST',headers:{authorization:'Bearer '+actor,'content-type':'image/jpeg'},body:image})),
     generateDocumentPdf(snapshot)
    ])
    assert.equal(a.status,200);assert.equal((await a.json()).answer,label);assert.equal(reserves,1);assert.equal(saves,1)
    assert.equal(o.status,200);const draft=await o.json();assert.equal(draft.vendor,label);assert.equal(draft.total,'105.25')
    assert.equal(Buffer.from(pdf.subarray(0,5)).toString(),'%PDF-');const parsed=await PDFDocument.load(pdf);assert.ok(parsed.getPageCount()>=1);assert.ok(parsed.getTitle()?.includes(snapshot.number));assert.equal(parsed.getAuthor(),label)
    // A changed tenant identity is denied by the handler before simulated provider work.
    const denied=await fin(new Request('https://local.test',{method:'POST',headers:{authorization:'Bearer '+actor},body:JSON.stringify({business_id:randomUUID(),thread_id:thread,request_id:randomUUID(),text:'Read another business'})}));assert.equal(denied.status,403)
    requests++;pdfBytes+=pdf.length;times.push(performance.now()-at);peakRss=Math.max(peakRss,process.memoryUsage().rss)
    assert.ok(Date.now()-started<300000,'Bounded workload deadline exceeded')
   }
  }))
  times.sort((a,b)=>a-b);phases.push({clients,workspaces:100,elapsedMs:Math.round(performance.now()-begin),p95Ms:Math.round(times[94]),p99Ms:Math.round(times[98]),unexpectedErrors:0})
 }
 assert.equal(requests,300);assert.equal(aiCalls,300);assert.equal(ocrCalls,300);assert.equal(networkAttempts,0)
 const result={sourceCommit:process.env.GITHUB_SHA||null,scope:'actual PDF rendering and Fin/OCR handler concurrency with simulated authorization, quota and provider dependencies',phases,workspaces:requests,pdfs:requests,pdfBytes,simulatedAiCalls:aiCalls,simulatedOcrCalls:ocrCalls,peakSimulatedProviderCalls:peakProviders,peakRssBytes:peakRss,externalNetworkAttempts:networkAttempts,externalProviderCost:0,totalMs:Date.now()-started,limitations:['In-process logical clients on one runner; no hosted network or Edge runtime measurement.','PDF templates use synthetic documents; JPEG-shaped payload exercises upload parsing, not real image recognition.','Authorization and quotas are simulated here; real RLS and quota races are separate PostgreSQL acceptance.','Simulated provider delay is ten milliseconds and does not predict live provider latency.']}
 await mkdir('tmp/provider-workload',{recursive:true});await writeFile('tmp/provider-workload/result.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result))
}finally{globalThis.fetch=originalFetch}

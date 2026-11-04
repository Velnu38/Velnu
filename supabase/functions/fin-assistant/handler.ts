import {draftSchema,answerSchema,draftInstructions,answerInstructions,validDraft,validateAnswer,responseText} from './core.ts'
export type FinContext={profile:unknown;records?:unknown;sources:{key:string;label:string}[];limits:string[];as_of:string;timezone:string}
export type FinSession={role:string;entitled:()=>Promise<boolean>;reserve:()=>Promise<void>;context:(mode:'draft'|'question')=>Promise<FinContext>}
export type FinDependencies={authorize:(authorization:string,businessId:string)=>Promise<FinSession|null>;configured:()=>boolean;complete:(instructions:string,input:string,schema:unknown)=>Promise<unknown>}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const headers={'content-type':'application/json','access-control-allow-origin':'*','access-control-allow-headers':'authorization,apikey,x-client-info,content-type','access-control-allow-methods':'POST,OPTIONS','cache-control':'no-store'}
export function finHandler(deps:FinDependencies){return async(req:Request)=>{
 const send=(status:number,value:unknown)=>new Response(JSON.stringify(value),{status,headers})
 if(req.method==='OPTIONS')return new Response('ok',{headers})
 if(req.method!=='POST')return send(405,{error:'Method not allowed'})
 if(!req.headers.get('authorization')?.startsWith('Bearer '))return send(401,{error:'Sign in to ask Fin.'})
 try{
  if(Number(req.headers.get('content-length')||0)>32000)return send(413,{error:'Keep your request under 6,001 characters.'})
  const raw=await req.text();if(raw.length>32000)return send(413,{error:'Request too long.'})
  let body;try{body=JSON.parse(raw)}catch{return send(400,{error:'Invalid request'})}
  if(!body||!uuid.test(body.business_id)||!['draft','question'].includes(body.mode)||typeof body.text!=='string'||!body.text.trim())return send(400,{error:'A business, request and valid mode are required.'})
  if(body.text.length>6000)return send(413,{error:'Keep your request under 6,001 characters.'})
  const history=body.history??[]
  if(!Array.isArray(history)||history.length>4||history.some((t:unknown)=>!t||typeof t!=='object'||typeof (t as any).question!=='string'||!(t as any).question.trim()||(t as any).question.length>2000||typeof (t as any).answer!=='string'||!(t as any).answer.trim()||(t as any).answer.length>1500||Object.keys(t).some(k=>!['question','answer'].includes(k))))return send(400,{error:'Conversation history is invalid. Start a new conversation.'})
  const session=await deps.authorize(req.headers.get('authorization')!,body.business_id)
  if(!session)return send(403,{error:'Sign in with access to this business.'})
  if(body.mode==='question'&&!['owner','admin'].includes(session.role))return send(403,{error:'Business questions are available to business owners and administrators.'})
  if(body.mode==='draft'&&!['owner','admin','office'].includes(session.role))return send(403,{error:'Your role cannot prepare financial drafts.'})
  if(!await session.entitled())return send(403,{error:'Fin requires Pro access, including an active Pro test grant.'})
  if(!deps.configured())return send(503,{error:'Fin’s language service is awaiting server setup.',code:'fin_not_configured'})
  const context=await session.context(body.mode)
  await session.reserve()
  const data=await deps.complete(body.mode==='draft'?draftInstructions:answerInstructions,JSON.stringify({context,request:body.text.trim(),...(body.mode==='question'?{prior_conversation:history}:{})}),body.mode==='draft'?draftSchema:answerSchema)
  let parsed;try{parsed=JSON.parse(responseText(data))}catch{return send(502,{error:'Fin could not prepare a complete answer. Try again or review the draft manually.'})}
  if(body.mode==='draft'){
   if(!validDraft(parsed,body.text.trim()))return send(502,{error:'Fin’s draft needs manual review.'})
   return send(200,{draft:parsed})
  }
  if(!validateAnswer(parsed,new Set(context.sources.map(s=>s.key))))return send(502,{error:'Fin could not verify the answer’s record references.'})
  const sources=context.sources.filter(s=>parsed.source_keys.includes(s.key))
  return send(200,{answer:parsed.answer,sources,limits:context.limits,as_of:context.as_of})
 }catch(error){
  const code=(error as {code?:string})?.code
  if(code==='42501')return send(403,{error:'Your business access changed. Please refresh.'})
  if(code==='P0001')return send(429,{error:'Fin’s request allowance is reached. Please try later.'})
  return send(503,{error:'Fin could not read the business records or reach its language service. No records were changed.'})
 }
}}

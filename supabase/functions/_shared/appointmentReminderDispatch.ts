/** Single-attempt appointment transport, separate from financial-document mutations. */
export type AppointmentClaim={id:string;status:string;channel:'email'|'sms';payload?:Record<string,unknown>;recipient?:string;sender?:string;body?:string}
export type AppointmentDispatchDependencies={emailMode:'disabled'|'private_beta'|'production';smsEnabled:boolean;claim:(id:string,beta:boolean)=>Promise<AppointmentClaim>;sendEmail:(id:string,payload:Record<string,unknown>)=>Promise<{id:string}>;sendSms:(claim:AppointmentClaim)=>Promise<{sid:string}>;finish:(id:string,status:'accepted'|'uncertain',provider:string|null)=>Promise<void>}
export async function dispatchAppointmentReminder(d:AppointmentDispatchDependencies,row:{id:string;channel:string}){
 if(row.channel==='email'?d.emailMode==='disabled':row.channel==='sms'?!d.smsEnabled:true)return{status:'paused'}
 const claim=await d.claim(row.id,d.emailMode!=='production')
 if(claim.status!=='claimed')return{status:claim.status}
 if(claim.id!==row.id||claim.channel!==row.channel){await d.finish(row.id,'uncertain',null).catch(()=>{});return{status:'uncertain'}}
 let provider:string
 try{
  if(claim.channel==='email'){
   if(!claim.payload)throw Error('Missing saved payload')
   const result=await d.sendEmail(claim.id,claim.payload)
   if(typeof result.id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(result.id))throw Error('Invalid receipt')
   provider=result.id
  }else{
   if(!claim.sender||!claim.recipient||!claim.body)throw Error('Missing saved SMS')
   const result=await d.sendSms(claim);if(!/^SM[0-9a-f]{32}$/i.test(result.sid))throw Error('Invalid receipt');provider=result.sid
  }
 }catch{await d.finish(claim.id,'uncertain',null).catch(()=>{});return{status:'uncertain'}}
 try{await d.finish(claim.id,'accepted',provider)}catch{return{status:'accepted',reconciliationPending:true}}
 return{status:'accepted'}
}

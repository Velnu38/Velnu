/** Small, provider-independent primitives; never expose card data or OAuth tokens. */
export const squareVersion='2026-09-16'
export const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
export const squareId=/^[A-Za-z0-9_-]{1,192}$/
export const hex64=/^[a-f0-9]{64}$/
const enc=new TextEncoder()
const owned=(value:Uint8Array)=>new Uint8Array(value).buffer
export async function digest(value:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(value))),b=>b.toString(16).padStart(2,'0')).join('')}
export function secret(){return Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('')}
const b64=(v:Uint8Array)=>btoa(String.fromCharCode(...v))
const bytes=(v:string)=>Uint8Array.from(atob(v),c=>c.charCodeAt(0))
export async function seal(value:unknown,keyBase64:string,context:string){const keyBytes=bytes(keyBase64);if(keyBytes.length!==32)throw Error('Token encryption is not configured');const iv=crypto.getRandomValues(new Uint8Array(12));const key=await crypto.subtle.importKey('raw',owned(keyBytes),'AES-GCM',false,['encrypt']);return{v:1,iv:b64(iv),data:b64(new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv:owned(iv),additionalData:owned(enc.encode(context))},key,owned(enc.encode(JSON.stringify(value))))))}}
export async function unseal(value:{v:number;iv:string;data:string},keyBase64:string,context:string):Promise<Record<string,any>>{if(value.v!==1)throw Error('Unknown token envelope');const keyBytes=bytes(keyBase64);if(keyBytes.length!==32)throw Error('Token encryption is not configured');const key=await crypto.subtle.importKey('raw',owned(keyBytes),'AES-GCM',false,['decrypt']);return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:owned(bytes(value.iv)),additionalData:owned(enc.encode(context))},key,owned(bytes(value.data)))))}
export async function validSquareSignature(raw:string,signature:string,keyString:string,notificationUrl:string){try{if(!keyString||!signature||signature.length>100)return false;const key=await crypto.subtle.importKey('raw',owned(enc.encode(keyString)),{name:'HMAC',hash:'SHA-256'},false,['verify']);return await crypto.subtle.verify('HMAC',key,owned(bytes(signature)),owned(enc.encode(notificationUrl+raw)))}catch{return false}}
export function validSquareCheckout(value:unknown,environment:string):value is string{if(typeof value!=='string')return false;try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&(environment==='sandbox'?u.hostname==='sandbox.square.link':u.hostname==='square.link')&&u.pathname.startsWith('/u/')}catch{return false}}
export function pointOfSaleUrl({platform,amount,applicationId,locationId,state,origin,operationId}:{platform:'ios'|'android';amount:number;applicationId:string;locationId:string;state:string;origin:string;operationId:string}){
 if(!Number.isSafeInteger(amount)||amount<50||amount>99999999||!uuid.test(operationId)||!hex64.test(state)||!squareId.test(locationId)||!/^sq0id[pb]-[A-Za-z0-9_-]+$/.test(applicationId))throw Error('Invalid point-of-sale configuration')
 const callback=new URL('/square-return',origin).href,metadata=operationId+'.'+state,note='Finviant payment '+operationId
 if(platform==='ios')return 'square-commerce-v1://payment/create?data='+encodeURIComponent(JSON.stringify({amount_money:{amount,currency_code:'USD'},callback_url:callback,client_id:applicationId,version:'1.3',location_id:locationId,state:metadata,notes:note,options:{supported_tender_types:['CREDIT_CARD'],clear_default_fees:true,auto_return:true,skip_receipt:false}}))
 return 'intent:#Intent;action=com.squareup.pos.action.CHARGE;package=com.squareup;'+[
 'S.browser_fallback_url='+encodeURIComponent(new URL('/?view=invoices',origin).href),
 'S.com.squareup.pos.WEB_CALLBACK_URI='+encodeURIComponent(callback),'S.com.squareup.pos.CLIENT_ID='+applicationId,'S.com.squareup.pos.LOCATION_ID='+locationId,
 'S.com.squareup.pos.API_VERSION=v2.1','i.com.squareup.pos.TOTAL_AMOUNT='+amount,'S.com.squareup.pos.CURRENCY_CODE=USD',
 'S.com.squareup.pos.TENDER_TYPES=com.squareup.pos.TENDER_CARD','S.com.squareup.pos.REQUEST_METADATA='+encodeURIComponent(metadata),
 'S.com.squareup.pos.NOTE='+encodeURIComponent(note),'l.com.squareup.pos.AUTO_RETURN_TIMEOUT_MS=3200',
 ].join(';')+';end'
}
/** Require a server-fetched payment, exact seller location/order/amount, and one card tender.
 * A browser status or amount alone is never payment evidence. */
export function verifiedSquarePayment(payment:Record<string,any>,operation:Record<string,any>,applicationId:string){
 const money=payment.amount_money,total=payment.total_money
 if(!squareId.test(String(payment.id||''))||payment.order_id!==operation.order_id||payment.location_id!==operation.location_id||!money||money.currency!=='USD'||money.amount!==operation.amount_minor||!total||total.currency!=='USD'||total.amount!==operation.amount_minor||payment.source_type!=='CARD'||Number(payment.tip_money?.amount||0)!==0||Number(payment.app_fee_money?.amount||0)!==0||!['COMPLETED','APPROVED','PENDING','FAILED','CANCELED'].includes(payment.status))throw Error('Payment verification failed')
 if(operation.kind==='pos'&&payment.note!=='Finviant payment '+operation.id)throw Error('Point of sale invoice reference could not be verified')
 if(payment.application_details?.application_id&&payment.application_details.application_id!==applicationId)throw Error('Payment application mismatch')
 const created=Date.parse(payment.created_at);if(!Number.isFinite(created)||created<Date.parse(operation.created_at)-60000||created>Date.now()+300000)throw Error('Payment timestamp mismatch')
 return payment
}

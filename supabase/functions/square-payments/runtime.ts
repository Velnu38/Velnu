import {createClient} from 'npm:@supabase/supabase-js@2.57.4'
import {resolveAppEnvironment} from '../_shared/appEnvironment.ts'
import {providerJson} from '../_shared/providerRequest.ts'
import {seal,unseal,squareVersion} from './core.ts'
import type {SquareDeps} from './handler.ts'
const project=Deno.env.get('SUPABASE_URL')||'',service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'',app=resolveAppEnvironment(project)
const applicationId=Deno.env.get('SQUARE_APPLICATION_ID')||'',clientSecret=Deno.env.get('SQUARE_APPLICATION_SECRET')||'',tokenKey=Deno.env.get('SQUARE_TOKEN_ENCRYPTION_KEY')||'',signatureKey=Deno.env.get('SQUARE_WEBHOOK_SIGNATURE_KEY')||''
export const squareEnvironment=Deno.env.get('FINVIANT_SQUARE_ENVIRONMENT')==='production'?'production':'sandbox'
const host=squareEnvironment==='production'?'https://connect.squareup.com':'https://connect.squareupsandbox.com'
const callback=project+'/functions/v1/square-payments?callback=oauth'
const db=project&&service?createClient(project,service,{auth:{persistSession:false,autoRefreshToken:false}}):null
const configured=!!app&&!!db&&!!applicationId&&!!clientSecret&&!!signatureKey&&/^[A-Za-z0-9+/]{43}=$/.test(tokenKey)
async function rpc(action:string,p:Record<string,unknown>){if(!db)throw Error('Database unavailable');const{data,error}=action==='pos_event_context'
 ?await db.rpc('square_pos_event_context',{p_merchant:p.merchant_id,p_environment:p.environment,p_location:p.location_id,p_operation:p.operation_id})
 :await db.rpc('square_service',{p_action:action,p});if(error)throw Error('Square operation unavailable');return data}
const oauth=async(body:Record<string,unknown>)=>await providerJson(host+'/oauth2/token',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({client_id:applicationId,client_secret:clientSecret,...body})},{timeoutMs:20000,maxBytes:65536}) as Record<string,any>
async function request(access:string,path:string,body?:Record<string,unknown>){if(!configured)throw Error('Square is not configured');if(!/^\/v2\/[a-z0-9/_-]+$/i.test(path))throw Error('Invalid provider path');return await providerJson(host+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+access,'Square-Version':squareVersion,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})},{timeoutMs:20000,maxBytes:262144}) as Record<string,any>}
async function square(business:string,path:string,body?:Record<string,unknown>){
 const c=await rpc('connection',{business_id:business});if(!c||c.environment!==squareEnvironment)throw Error('Merchant not connected')
 let tokens=await unseal(c.token_envelope,tokenKey,c.business_id+':'+c.merchant_id+':'+squareEnvironment)
 if(Date.parse(c.token_expires_at)<Date.now()+3*86400000){const next=await oauth({grant_type:'refresh_token',refresh_token:tokens.refresh_token});if(next.merchant_id!==c.merchant_id||!next.access_token||!next.refresh_token||!Number.isFinite(Date.parse(next.expires_at)))throw Error('Reconnect Square');const saved=await rpc('refresh',{business_id:business,version:c.token_version,token_envelope:await seal(next,tokenKey,c.business_id+':'+c.merchant_id+':'+squareEnvironment),token_expires_at:next.expires_at});if(!saved.saved){const latest=await rpc('connection',{business_id:business});tokens=await unseal(latest.token_envelope,tokenKey,c.business_id+':'+c.merchant_id+':'+squareEnvironment)}else tokens=next}
 return request(tokens.access_token,path,body)
}
export const deps:SquareDeps={configured,allowNewPayments:Deno.env.get('FINVIANT_SQUARE_ENABLED')==='true',environment:squareEnvironment,applicationId,origin:app?.baseUrl||'https://finviant.com',origins:app?.origins||['https://finviant.com'],callback,rpc,oauth,square,
 authenticate:async(req)=>{if(!db)throw Error('Auth unavailable');const header=req.headers.get('authorization')||'';if(!header.startsWith('Bearer '))throw Error('Unauthorized');const{data,error}=await db.auth.getUser(header.slice(7));if(error||!data.user)throw Error('Unauthorized');return data.user.id},
 saveTokens:async(identity,tokens)=>{
  const [result,profile]=await Promise.all([request(tokens.access_token,'/v2/locations'),request(tokens.access_token,'/v2/merchants/'+encodeURIComponent(tokens.merchant_id))]);if(profile.merchant?.id!==tokens.merchant_id||profile.merchant?.status!=='ACTIVE'||profile.merchant?.currency!=='USD'||profile.merchant?.country!=='US')throw Error('An active US USD merchant account is required');const eligible=(result.locations||[]).filter((l:any)=>l.status==='ACTIVE'&&l.currency==='USD'&&l.capabilities?.includes('CREDIT_CARD_PROCESSING'))
  // The server-verified Square primary location is the first connection default.
  // Reconnects retain the original location so prior payment/refund bindings survive.
  const existing=await rpc('connection',{business_id:identity.business_id});const location=existing?eligible.find((l:any)=>l.id===existing.location_id):eligible.find((l:any)=>l.id===profile.merchant.main_location_id)||null
  if(!location)throw Error('The Square primary location must be ready for USD card processing')
  await rpc('oauth_save',{...identity,merchant_id:tokens.merchant_id,environment:squareEnvironment,location_id:location.id,location_name:location.name||location.id,token_envelope:await seal(tokens,tokenKey,identity.business_id+':'+tokens.merchant_id+':'+squareEnvironment),token_expires_at:tokens.expires_at})
 },
 apply:async(p)=>{if(!db)throw Error('Database unavailable');const{data,error}=await db.rpc('apply_square_payment',{p});if(error)throw Error('Payment ledger unavailable');return data},
}
export const webhook={key:signatureKey,url:project+'/functions/v1/square-payment-events'}

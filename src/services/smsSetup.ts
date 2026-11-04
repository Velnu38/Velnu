import {supabase} from '../lib/supabase'
import {normalizeMobile} from '../lib/smsPhone'
export type SmsSetupStatus={owner_mobile_verified:boolean;phone_last4:string|null;customer_sms_enabled:boolean;phone_verification_available:boolean}
export async function getSmsSetupStatus(businessId:string):Promise<SmsSetupStatus>{
 const {data,error}=await supabase.rpc('get_sms_setup_status',{p_business:businessId})
 if(error||!data||typeof data.owner_mobile_verified!=='boolean')throw new Error('SMS setup could not be checked. Sign in as the primary business owner and retry.')
 let available=false
 try{const response=await fetch(import.meta.env.VITE_SUPABASE_URL+'/auth/v1/settings',{headers:{apikey:import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY},signal:AbortSignal.timeout(10000)});if(response.ok){const settings=await response.json();available=settings?.external?.phone===true}}catch{/* Unavailable verification stays locked; saved verified status is still useful. */}
 return {...data,phone_verification_available:available}
}
function phoneError(error:{message:string;code?:string}):Error{
 const detail=(error.code||'')+' '+error.message
 if(/rate|too many|over_sms_send_rate_limit/i.test(detail))return new Error('Please wait before requesting or checking another code.')
 if(/provider|disabled|not enabled|error sending|unsupported/i.test(detail))return new Error('Mobile verification is awaiting SMS provider setup. Email sign-in is still available.')
 if(/expired|invalid.*(?:code|token)|otp_expired/i.test(detail))return new Error('That code is invalid or expired. Check the code or request a new one after the wait period.')
 return new Error('Mobile verification could not be completed. Check your number and code, then retry deliberately.')
}
export async function requestMobileCode(businessId:string,value:string,resend=false){
 const setup=await getSmsSetupStatus(businessId);if(!setup.phone_verification_available)throw new Error('Mobile verification is awaiting SMS provider setup. Email sign-in is still available.') // Authorize the business owner before changing account phone details.
 const phone=normalizeMobile(value);if(!phone)throw new Error('Enter a mobile number with country code, such as +1 757 555 0123.')
 const result=resend?await supabase.auth.resend({type:'phone_change',phone}):await supabase.auth.updateUser({phone})
 if(result.error)throw phoneError(result.error)
 return phone
}
export async function confirmMobileCode(businessId:string,phone:string,code:string){
 await getSmsSetupStatus(businessId)
 if(!/^\d{6}$/.test(code))throw new Error('Enter the six-digit code sent to your mobile.')
 const current=await supabase.auth.getUser();if(current.error||!current.data.user)throw new Error('Please sign in again before verifying your number.')
 const {data,error}=await supabase.auth.verifyOtp({phone,token:code,type:'phone_change'})
 if(error)throw phoneError(error)
 if(data.user?.id!==current.data.user.id||!data.user.phone_confirmed_at||data.user.phone?.replace(/^\+/,'')!==phone.replace(/^\+/,''))throw new Error('The requested mobile number has not been confirmed. Refresh its status and retry.')
 const verified=await getSmsSetupStatus(businessId)
 if(!verified.owner_mobile_verified)throw new Error('The number is not confirmed yet. Refresh its status before sending SMS.')
 return verified
}

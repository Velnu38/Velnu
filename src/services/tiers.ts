import {supabase} from '../lib/supabase'
import type {VelnuTier} from '../lib/pricing'
export type TierUsage={plan:VelnuTier;actual_plan:VelnuTier;testing:boolean;can_test:boolean;introductory:boolean;period_end:string;customers_used:number;customers_limit:number|null;jobs_used:number;jobs_limit:number|null;seats_used:number;seats_limit:number;ai_used:number;ai_limit:number;voice_used:number;voice_limit:number;email_used:number;email_limit:number;sms_used:number;sms_limit:number;financial_history:boolean;delivery_mode:'personal'|'managed'}
export type DeliverySetup={plan:VelnuTier;email:string|null;phone:string|null;personal_email_ready:boolean;personal_sms_ready:boolean;managed_email_ready:boolean;managed_sms_ready:boolean;acknowledged:boolean;reply_to:string|null;sms_reply_route:string|null}
async function rpc<T>(name:string,args:Record<string,unknown>):Promise<T>{const{data,error}=await supabase.rpc(name,args);if(error)throw new Error(error.message);return data as T}
export const getTierUsage=(business:string)=>rpc<TierUsage>('get_plan_usage',{target_business_id:business})
export const setTierTest=(business:string,tier:VelnuTier|null)=>rpc<TierUsage>('set_tier_test',{p_business:business,p_tier:tier})
export const getDeliverySetup=(business:string)=>rpc<DeliverySetup>('get_delivery_setup',{p_business:business})
export const saveDeliverySetup=(business:string,settings:{email:string;phone:string;emailReady:boolean;smsReady:boolean})=>rpc<DeliverySetup>('save_delivery_setup',{p_business:business,p_email:settings.email.trim(),p_phone:settings.phone.trim(),p_email_ready:settings.emailReady,p_sms_ready:settings.smsReady,p_acknowledged:true})

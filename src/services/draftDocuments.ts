import {supabase} from '../lib/supabase'
import {validateDocumentInput} from '../lib/financialValidation'
import {announceCalendarChange} from '../lib/workEvents'
import {estimatePaymentMessage} from '../lib/estimatePaymentTerms'
export async function updateDraftDocument(businessId:string,kind:'invoice'|'estimate',id:string,version:string,input:{customer_id:string;due_date?:string|null;expires_on?:string|null;payment_terms_days?:number|null;notes:string;customer_message:string;customer_reference?:string;items:{description:string;quantity:number;unit_price:number;tax_rate:number}[]}) {
 validateDocumentInput({...input,customer_message:kind==='estimate'?estimatePaymentMessage(input.customer_message,input.payment_terms_days==null?'':String(input.payment_terms_days)):input.customer_message})
 const {data,error}=await supabase.rpc('update_draft_document',{target_business_id:businessId,document_kind:kind,document_id:id,expected_updated_at:version,payload:input})
 if(error)throw error
 if(data?.id!==id)throw new Error('The draft save could not be confirmed. Reload the draft before making another change.')
 announceCalendarChange();return data
}

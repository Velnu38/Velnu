import {supabase} from '../lib/supabase'
import type {CustomerStatement} from '../../shared/customerStatementPdf'
export type {CustomerStatement} from '../../shared/customerStatementPdf'
export async function getCustomerStatement(business:string,customer:string):Promise<CustomerStatement>{const{data,error}=await supabase.rpc('get_customer_statement',{p_business:business,p_customer:customer});if(error)throw error;return data}
export async function downloadCustomerStatement(business:string,customer:string){const statement=await getCustomerStatement(business,customer),{customerStatementPdf}=await import('../../shared/customerStatementPdf'),bytes=await customerStatementPdf(statement),blob=new Blob([new Uint8Array(bytes)],{type:'application/pdf'}),url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='Finviant-account-statement-'+statement.as_of+'.pdf';document.body.append(a);a.click();a.remove();window.setTimeout(()=>URL.revokeObjectURL(url),10000)}

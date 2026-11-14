import { supabase } from '../lib/supabase'
import { collectBusinessRecords } from '../lib/businessRecords'

export type CustomerPaymentReview = {
  id: string; invoice_id: string; invoice_number: string | null;
  amount: number; currency: string; reason: string; created_at: string;
}
export async function listCustomerPaymentReviews(businessId: string): Promise<CustomerPaymentReview[]> {
  return await collectBusinessRecords((from, to) => supabase.rpc('list_customer_payment_reviews', {
    p_business: businessId,
  }, { count: 'exact' }).order('created_at', { ascending: false }).order('id').range(from, to)) as CustomerPaymentReview[]
}

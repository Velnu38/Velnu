import { createClient } from 'npm:@supabase/supabase-js@2.57.4'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const emailPattern = /^[^\s@<>\r\n]+@[^\s@<>\r\n]+\.[^\s@<>\r\n]+$/
const origins = new Set(['https://finviant.com', 'https://www.finviant.com', 'https://app.finviant.com', 'https://velnu-git-feature-velnu-stage1-mbarone5-1747.vercel.app', 'http://localhost:5173'])
const configuredOrigin = Deno.env.get('FINVIANT_APP_BASE_URL')
if (configuredOrigin) origins.add(new URL(configuredOrigin).origin)
const esc = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('Origin') || ''
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': origins.has(origin) ? origin : 'https://finviant.com', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Vary': 'Origin', 'Cache-Control': 'no-store' }
  const respond = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers })
  if (origin && !origins.has(origin)) return respond(403, { error: 'This app address is not authorized.' })
  if (req.method === 'OPTIONS') return new Response('ok', { headers })
  if (req.method !== 'POST') return respond(405, { error: 'Method not allowed.' })
  try {
    const authorization = req.headers.get('Authorization') || ''
    if (!authorization.startsWith('Bearer ')) return respond(401, { error: 'Sign in to email an invoice.' })
    const url = Deno.env.get('SUPABASE_URL')
    const key = Deno.env.get('SUPABASE_ANON_KEY')
    const resendKey = Deno.env.get('RESEND_API_KEY')
    if (!url || !key || !resendKey) return respond(503, { error: 'Invoice email is not configured. Contact support.' })
    // Use the caller's session, never a service-role key: RLS stays active.
    const db = createClient(url, key, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } })
    const { data: auth, error: authError } = await db.auth.getUser()
    if (authError || !auth.user) return respond(401, { error: 'Your session expired. Sign in again.' })
    let input: Record<string, unknown>
    try { input = await req.json() } catch { return respond(400, { error: 'Invalid request.' }) }
    if (!input || typeof input !== 'object') return respond(400, { error: 'Invalid request.' })
    const businessId = String(input.business_id || '')
    const invoiceId = String(input.invoice_id || '')
    const requestId = String(input.request_id || '')
    if (![businessId, invoiceId, requestId].every(value => uuid.test(value))) return respond(400, { error: 'Valid business, invoice and request IDs are required.' })
    const { data: membership, error: memberError } = await db.from('business_members').select('role').eq('business_id', businessId).eq('user_id', auth.user.id).maybeSingle()
    if (memberError || !membership || !['owner', 'admin', 'office'].includes(membership.role)) return respond(403, { error: 'You do not have permission to email this invoice.' })
    const { data: invoice, error: invoiceError } = await db.from('invoices').select('id,customer_id,invoice_number,status,issue_date,due_date,subtotal,tax_amount,total,amount_paid,balance_due,customer_message').eq('business_id', businessId).eq('id', invoiceId).maybeSingle()
    if (invoiceError) return respond(500, { error: 'Unable to load invoice.' })
    if (!invoice) return respond(404, { error: 'Invoice not found.' })
    if (invoice.status === 'void') return respond(409, { error: 'A void invoice cannot be emailed.' })
    const [businessResult, customerResult, itemsResult] = await Promise.all([
      db.from('businesses').select('name,email,phone,currency').eq('id', businessId).single(),
      db.from('customers').select('id,first_name,last_name,company,email').eq('business_id', businessId).eq('id', invoice.customer_id).single(),
      db.from('invoice_items').select('description,quantity,unit_price,tax_rate,line_total').eq('business_id', businessId).eq('invoice_id', invoiceId).order('sort_order').order('id'),
    ])
    if (businessResult.error || customerResult.error || itemsResult.error) return respond(500, { error: 'Unable to load invoice details.' })
    const business = businessResult.data
    const customer = customerResult.data
    const recipient = String(customer.email || '').trim()
    if (!emailPattern.test(recipient)) return respond(409, { error: 'Add a valid email address to this customer before sending.' })
    if (!itemsResult.data.length) return respond(409, { error: 'Add at least one line item before sending.' })
    const money = (value: unknown) => new Intl.NumberFormat('en-US', { style: 'currency', currency: business.currency || 'USD' }).format(Number(value || 0))
    const name = [customer.first_name, customer.last_name].filter(Boolean).join(' ') || customer.company || 'Customer'
    const number = invoice.invoice_number || 'Invoice'
    const subject = `${String(business.name).replace(/[\r\n]/g, ' ')}: Invoice ${number}`
    // Only customer-facing fields are included. Internal notes are never selected.
    const text = [business.name, `Invoice ${number}`, '', `Hi ${name},`, '', `Issued: ${invoice.issue_date}`, invoice.due_date ? `Due: ${invoice.due_date}` : 'Due date: contact the business', '', ...itemsResult.data.map((item, index) => `${index + 1}. ${item.description}\n   ${Number(item.quantity)} × ${money(item.unit_price)} = ${money(item.line_total)}${Number(item.tax_rate) ? ` (tax rate: ${Number(item.tax_rate)}%)` : ''}`), '', `Subtotal: ${money(invoice.subtotal)}`, `Tax: ${money(invoice.tax_amount)}`, `Total: ${money(invoice.total)}`, `Paid: ${money(invoice.amount_paid)}`, `Balance due: ${money(invoice.balance_due)}`, '', invoice.customer_message || '', '', 'Please contact the business directly for payment arrangements.', business.email || '', business.phone || ''].filter(value => value !== null).join('\n')
    const { data: existing, error: existingError } = await db.from('messages').select('id,invoice_id,business_id,recipient,subject,body,status,provider_message_id,created_at').eq('id', requestId).eq('business_id', businessId).maybeSingle()
    if (existingError) return respond(500, { error: 'Unable to check email status.' })
    if (existing && existing.invoice_id !== invoiceId) return respond(409, { error: 'This request belongs to another invoice.' })
    if (existing?.provider_message_id && ['sent', 'delivered'].includes(existing.status)) return respond(200, { status: 'accepted', email_id: existing.provider_message_id, recipient: existing.recipient, already_sent: true })
    if (existing && Date.now() - Date.parse(existing.created_at) > 23 * 3600000) return respond(409, { error: 'This send attempt is too old to retry safely. Check email activity before starting a new send.' })
    if (!existing) {
      const { count, error: countError } = await db.from('messages').select('id', { count: 'exact', head: true }).eq('business_id', businessId).eq('channel', 'email').eq('direction', 'outbound').gte('created_at', new Date(Date.now() - 3600000).toISOString())
      if (countError) return respond(503, { error: 'Unable to check email limits.' })
      if ((count || 0) >= 100) return respond(429, { error: 'Hourly email limit reached. Please try later.' })
      const { error: logError } = await db.from('messages').insert({ id: requestId, business_id: businessId, customer_id: customer.id, invoice_id: invoiceId, direction: 'outbound', channel: 'email', recipient, subject, body: text, provider: 'resend', status: 'queued' })
      if (logError) return respond(logError.code === '23505' ? 409 : 500, { error: logError.code === '23505' ? 'This send is already processing. Retry the same request shortly.' : 'Unable to save email activity; nothing was sent.' })
    }
    // Reuse the original message on retries, and the same provider key. Never
    // generate a new key automatically following an uncertain network outcome.
    const sendText = existing?.body ?? text
    const sendTo = existing?.recipient ?? recipient
    const payload = { from: 'Finviant Office <notifications@finviant.com>', to: [sendTo], subject: existing?.subject ?? subject, text: sendText, html: `<!doctype html><html><head><meta charset="utf-8"></head><body><div style="max-width:640px;margin:auto;padding:24px;font-family:Arial,Helvetica,sans-serif"><pre style="font:inherit;line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere">${esc(sendText)}</pre></div></body></html>` }
    let response: Response
    try {
      response = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': `owedly-invoice-${businessId}-${requestId}` }, body: JSON.stringify(payload), signal: AbortSignal.timeout(20000) })
    } catch {
      return respond(504, { error: 'The email provider did not confirm the result. Retry this same send; do not start a separate send.' })
    }
    if (!response.ok) {
      await db.from('messages').update({ status: 'failed' }).eq('id', requestId).eq('business_id', businessId)
      return respond(response.status === 429 ? 429 : 502, { error: 'The email provider did not accept this request. Retry the same send or contact support.' })
    }
    const sent = await response.json()
    if (typeof sent.id !== 'string') return respond(502, { error: 'The email provider returned an unexpected result. Retry this same send.' })
    const now = new Date().toISOString()
    const [messageUpdate, invoiceUpdate] = await Promise.all([
      db.from('messages').update({ status: 'sent', provider_message_id: sent.id, sent_at: now }).eq('id', requestId).eq('business_id', businessId),
      db.from('invoices').update({ status: 'sent', sent_at: now }).eq('id', invoiceId).eq('business_id', businessId).eq('status', 'draft'),
    ])
    return respond(200, { status: 'accepted', email_id: sent.id, recipient: sendTo, warning: messageUpdate.error || invoiceUpdate.error ? 'Email accepted, but activity or invoice status could not be updated. Do not resend just to refresh the status.' : null })
  } catch {
    return respond(500, { error: 'Unexpected error. Check email activity before retrying the same send.' })
  }
})

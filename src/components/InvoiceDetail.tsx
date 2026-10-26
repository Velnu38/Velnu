import { FormEvent, useEffect, useRef, useState } from 'react'
import { canWrite, type CurrentBusiness } from '../lib/business'
import { createInvoiceReminder, getInvoiceDetail } from '../services/invoiceDetail'
import { recordPayment } from '../services/payments'
import { updateInvoiceStatus } from '../services/invoices'
import InvoiceEmailButton from './InvoiceEmailButton'
import DocumentBrand from './DocumentBrand'

type Customer = { id:string; first_name:string|null; last_name:string|null; company:string|null; email:string|null; phone:string|null }
type Invoice = { id:string; invoice_number:string|null; status:string; issue_date:string; due_date:string|null; subtotal:number; tax_amount:number; total:number; amount_paid:number; balance_due:number; notes:string|null; customer_message:string|null; sent_at:string|null; paid_at:string|null; customer_id:string; customers:Customer|Customer[]|null }
type Item = { id:string; description:string; quantity:number; unit_price:number; tax_rate:number; line_total:number }
type Payment = { id:string; amount:number; method:string|null; status:string; paid_at:string; notes:string|null }
type Message = { id:string; direction:string; channel:string; recipient:string|null; subject:string|null; body:string; status:string; sent_at:string|null; created_at:string }
type Detail = { invoice:Invoice; items:Item[]; payments:Payment[]; messages:Message[] }

function customerName(customer?: Customer | null) {
  if (!customer) return 'Customer'
  return [customer.first_name, customer.last_name].filter(Boolean).join(' ') || customer.company || 'Customer'
}

export default function InvoiceDetail({ business, invoiceId, onBack }: { business:CurrentBusiness; invoiceId:string; onBack:()=>void }) {
  const [detail,setDetail]=useState<Detail|null>(null)
  const [loading,setLoading]=useState(true)
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const [showPayment,setShowPayment]=useState(false)
  const [showReminder,setShowReminder]=useState(false)
  const [amount,setAmount]=useState('')
  const [method,setMethod]=useState<'cash'|'check'|'card'|'ach'|'other'>('other')
  const [paymentNote,setPaymentNote]=useState('')
  const [reminderAt,setReminderAt]=useState('')
  const [reminderNote,setReminderNote]=useState('Follow up on unpaid invoice')
  const paymentRetryRef=useRef<{signature:string; requestId:string}|null>(null)

  async function refresh(){setLoading(true);setError('');try{const next=await getInvoiceDetail(business.id,invoiceId) as Detail;setDetail(next);setAmount(String(next.invoice.balance_due))}catch(err){setError(err instanceof Error?err.message:'Unable to load invoice')}finally{setLoading(false)}}
  useEffect(()=>{setDetail(null);void refresh()},[business.id,invoiceId])

  async function savePayment(event:FormEvent){
    event.preventDefault();if(!detail||busy)return;setBusy(true);setError('')
    try{const value=Number(amount);if(!Number.isFinite(value)||value<=0||value>Number(detail.invoice.balance_due))throw new Error('Enter a payment greater than zero and no more than the balance due.');if(!window.confirm('Have you actually received this payment? Velnu will record it, not charge the customer.'))return;const signature=JSON.stringify({id:detail.invoice.id,value,method,paymentNote});if(paymentRetryRef.current?.signature!==signature)paymentRetryRef.current={signature,requestId:crypto.randomUUID()};await recordPayment(business.id,{invoice_id:detail.invoice.id,amount:value,method,notes:paymentNote,request_id:paymentRetryRef.current.requestId});paymentRetryRef.current=null;setShowPayment(false);setPaymentNote('');await refresh()}catch(err){setError(err instanceof Error?err.message:'Unable to record payment')}finally{setBusy(false)}
  }

  async function saveReminder(event:FormEvent){
    event.preventDefault();if(!detail||busy)return;setBusy(true);setError('')
    try{const due=new Date(reminderAt);if(Number.isNaN(due.getTime())||due.getTime()<=Date.now())throw new Error('Choose a reminder date and time in the future.');await createInvoiceReminder(business.id,detail.invoice.id,detail.invoice.customer_id,due.toISOString(),reminderNote);setShowReminder(false);setReminderAt('');await refresh()}catch(err){setError(err instanceof Error?err.message:'Unable to create reminder')}finally{setBusy(false)}
  }

  async function markSent(){if(!detail||busy)return;if(!window.confirm('This only records that you sent the invoice outside Velnu. It does not email the customer. Continue?'))return;setBusy(true);setError('');try{await updateInvoiceStatus(detail.invoice.id,'sent');await refresh()}catch(err){setError(err instanceof Error?err.message:'Unable to mark invoice sent')}finally{setBusy(false)}}

  async function voidInvoice(){if(!detail||busy||detail.invoice.status==='void'||Number(detail.invoice.amount_paid)>0)return;if(!window.confirm('Void this invoice? This cannot be undone, and the invoice will remain in your records.'))return;setBusy(true);setError('');try{await updateInvoiceStatus(detail.invoice.id,'void');await refresh()}catch(err){setError(err instanceof Error?err.message:'Unable to void invoice')}finally{setBusy(false)}}

  if(loading&&!detail)return <div className="detail-loading">Loading invoice…</div>
  if(!detail)return <div className="empty-state"><h2>Invoice unavailable</h2>{error&&<p role="alert">{error}</p>}<button className="secondary-button" onClick={onBack}>Back to invoices</button></div>
  const invoice=detail.invoice
  const customer=Array.isArray(invoice.customers)?invoice.customers[0]:invoice.customers

  return <div className="page-stack invoice-detail-page">
    <div className="detail-top"><button className="back-button" onClick={onBack}>← Invoices</button></div>
    <section className="invoice-hero">
      <div><p className="eyebrow">{invoice.status}</p><h1>{invoice.invoice_number||'Invoice'}</h1><p>{customerName(customer)}{customer?.email?` · ${customer.email}`:''}</p></div>
      <div className="invoice-hero-balance"><span>Balance due</span><strong>${Number(invoice.balance_due).toFixed(2)}</strong><small>Total ${Number(invoice.total).toFixed(2)}</small></div>
    </section>
    <div className="invoice-action-bar">
      {canWrite(business.role)&&invoice.status!=='void'&&<InvoiceEmailButton key={invoice.id} businessId={business.id} invoiceId={invoice.id} recipient={customer?.email} disabled={busy} onSent={refresh}/>}
      {canWrite(business.role)&&invoice.status==='draft'&&<button className="secondary-button" onClick={markSent} disabled={busy}>Mark sent manually</button>}
      {canWrite(business.role)&&!['void','paid'].includes(invoice.status)&&Number(invoice.amount_paid)===0&&<button className="secondary-button" onClick={voidInvoice} disabled={busy}>Void invoice</button>}
      {canWrite(business.role)&&invoice.status!=='void'&&Number(invoice.balance_due)>0&&<button className="secondary-button" disabled={busy} onClick={()=>setShowReminder(true)}>Schedule reminder</button>}
      {canWrite(business.role)&&!['draft','void'].includes(invoice.status)&&Number(invoice.balance_due)>0&&<button className="primary-button" disabled={busy} onClick={()=>setShowPayment(true)}>Record payment</button>}
      <button className="secondary-button" onClick={()=>window.print()}>Print / Save PDF</button>
    </div>
    {error&&<p className="form-message error-text" role="alert">{error}</p>}
    <section className="invoice-detail-grid">
      <article className="detail-card invoice-document print-document">
        <DocumentBrand business={business} kind="Invoice" />
        <div className="document-bill-to"><small>Bill to</small><strong>{customerName(customer)}</strong>{customer?.email && <span>{customer.email}</span>}{customer?.phone && <span>{customer.phone}</span>}</div>
        <div className="invoice-meta"><div><span>Issued</span><strong>{new Date(invoice.issue_date+'T00:00:00').toLocaleDateString()}</strong></div><div><span>Due</span><strong>{invoice.due_date?new Date(invoice.due_date+'T00:00:00').toLocaleDateString():'—'}</strong></div></div>
        <div className="invoice-table"><div className="invoice-table-head"><span>Description</span><span>Qty</span><span>Rate</span><span>Total</span></div>{detail.items.map(item=><div className="invoice-table-row" key={item.id}><span>{item.description}{Number(item.tax_rate)>0&&<small>{Number(item.tax_rate).toFixed(2)}% tax</small>}</span><span>{Number(item.quantity)}</span><span>${Number(item.unit_price).toFixed(2)}</span><strong>${Number(item.line_total).toFixed(2)}</strong></div>)}</div>
        <div className="invoice-totals"><div><span>Subtotal</span><strong>${Number(invoice.subtotal).toFixed(2)}</strong></div><div><span>Tax</span><strong>${Number(invoice.tax_amount).toFixed(2)}</strong></div><div><span>Paid</span><strong>−${Number(invoice.amount_paid).toFixed(2)}</strong></div><div className="grand-total"><span>Balance due</span><strong>${Number(invoice.balance_due).toFixed(2)}</strong></div></div>
        {invoice.customer_message&&<div className="invoice-note"><strong>Message to customer</strong><p>{invoice.customer_message}</p></div>}
        {invoice.notes&&<div className="invoice-note internal"><strong>Internal notes (not printed)</strong><p>{invoice.notes}</p></div>}
        {business.document_footer && <div className="document-footer">{business.document_footer}</div>}
      </article>
      <aside className="invoice-side-stack">
        <article className="detail-card"><p className="eyebrow">Payments</p><h2>Payment history</h2>{detail.payments.length===0?<p className="quiet">No payments recorded.</p>:<div className="history-list">{detail.payments.map(payment=><div className="history-row compact-history" key={payment.id}><div className="row-main"><strong>{payment.method||'Payment'}</strong><span>{new Date(payment.paid_at).toLocaleDateString()} · {payment.status}</span></div><strong>${Number(payment.amount).toFixed(2)}</strong></div>)}</div>}</article>
        <article className="detail-card"><p className="eyebrow">Activity</p><h2>Messages</h2>{detail.messages.length===0?<p className="quiet">No invoice messages yet.</p>:<div className="message-list">{detail.messages.map(message=><div className="message-item" key={message.id}><div><strong>{message.channel.toUpperCase()}</strong><span>{message.status==='sent'?'Accepted for delivery':message.status}</span></div><p>{message.body}</p><small>{new Date(message.sent_at||message.created_at).toLocaleString()}</small></div>)}</div>}</article>
      </aside>
    </section>
    {showPayment&&<div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-label="Record payment"><div className="modal-head"><div><p className="eyebrow">Payment</p><h2>Record money received</h2></div><button className="icon-button" disabled={busy} onClick={()=>setShowPayment(false)}>×</button></div><form className="form-grid" onSubmit={savePayment}><label>Amount<input type="number" min="0.01" max={Number(invoice.balance_due)} step="0.01" value={amount} onChange={e=>setAmount(e.target.value)} required/></label><label>Method<select value={method} onChange={e=>setMethod(e.target.value as typeof method)}><option value="cash">Cash</option><option value="check">Check</option><option value="card">Card</option><option value="ach">ACH</option><option value="other">Other</option></select></label><label className="full">Notes<input value={paymentNote} onChange={e=>setPaymentNote(e.target.value)}/></label>{error&&<p className="form-message error-text full">{error}</p>}<div className="modal-actions full"><button type="button" className="secondary-button" disabled={busy} onClick={()=>setShowPayment(false)}>Cancel</button><button className="primary-button" disabled={busy}>{busy?'Saving…':'Record payment'}</button></div></form></section></div>}
    {showReminder&&<div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-label="Schedule reminder"><div className="modal-head"><div><p className="eyebrow">Reminder</p><h2>Schedule invoice follow-up</h2></div><button className="icon-button" disabled={busy} onClick={()=>setShowReminder(false)}>×</button></div><form className="form-grid" onSubmit={saveReminder}><label className="full">Remind me at<input type="datetime-local" value={reminderAt} onChange={e=>setReminderAt(e.target.value)} required/></label><label className="full">Note<textarea value={reminderNote} onChange={e=>setReminderNote(e.target.value)}/></label>{error&&<p className="form-message error-text full">{error}</p>}<div className="modal-actions full"><button type="button" className="secondary-button" disabled={busy} onClick={()=>setShowReminder(false)}>Cancel</button><button className="primary-button" disabled={busy}>{busy?'Saving…':'Schedule reminder'}</button></div></form></section></div>}
  </div>
}

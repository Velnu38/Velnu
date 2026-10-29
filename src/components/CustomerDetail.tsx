import { FormEvent, useEffect, useState } from 'react'
import { canWrite, type CurrentBusiness } from '../lib/business'
import { getCustomerDetail } from '../services/customerDetail'
import { createProperty } from '../services/properties'
import GoogleMapTools from './GoogleMapTools'

type Customer = { id:string; first_name:string|null; last_name:string|null; company:string|null; email:string|null; phone:string|null; notes:string|null }
type Property = { id:string; label:string|null; address_line1:string; address_line2:string|null; city:string|null; state:string|null; postal_code:string|null; access_notes:string|null }
type Job = { id:string; title:string; status:string; scheduled_start:string|null; completed_at:string|null; description:string|null }
type Estimate = { id:string; estimate_number:string|null; status:string; total:number; issue_date:string; expires_on:string|null }
type Invoice = { id:string; invoice_number:string|null; status:string; total:number; amount_paid:number; balance_due:number; issue_date:string; due_date:string|null }

type Detail = { customer:Customer; properties:Property[]; jobs:Job[]; estimates:Estimate[]; invoices:Invoice[] }

function displayName(customer: Customer) {
  return [customer.first_name, customer.last_name].filter(Boolean).join(' ') || customer.company || 'Customer'
}

export default function CustomerDetail({ business, customerId, onBack }: { business:CurrentBusiness; customerId:string; onBack:()=>void }) {
  const [detail,setDetail]=useState<Detail|null>(null)
  const [loading,setLoading]=useState(true)
  const [showProperty,setShowProperty]=useState(false)
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const [property,setProperty]=useState({label:'',address_line1:'',address_line2:'',city:'',state:'',postal_code:'',access_notes:''})

  async function refresh(){setLoading(true);try{setDetail(await getCustomerDetail(business.id,customerId) as Detail)}finally{setLoading(false)}}
  useEffect(()=>{refresh()},[business.id,customerId])

  async function addProperty(event:FormEvent){
    event.preventDefault();setBusy(true);setError('')
    try{
      await createProperty(business.id,{customer_id:customerId,...property})
      setProperty({label:'',address_line1:'',address_line2:'',city:'',state:'',postal_code:'',access_notes:''})
      setShowProperty(false);await refresh()
    }catch(err){setError(err instanceof Error?err.message:'Unable to add property')}finally{setBusy(false)}
  }

  if(loading&&!detail)return <div className="detail-loading">Loading customer…</div>
  if(!detail)return <div className="empty-state"><h2>Customer unavailable</h2><button className="secondary-button" onClick={onBack}>Back to customers</button></div>
  const {customer}=detail
  const outstanding=detail.invoices.reduce((sum,invoice)=>sum+Number(invoice.balance_due||0),0)

  return <div className="page-stack">
    <div className="detail-top"><button className="back-button" onClick={onBack}>← Customers</button></div>
    <section className="customer-hero">
      <div className="avatar large">{displayName(customer).charAt(0).toUpperCase()}</div>
      <div className="customer-hero-main"><p className="eyebrow">Customer</p><h1>{displayName(customer)}</h1><div className="customer-contact">{customer.company&&displayName(customer)!==customer.company&&<span>{customer.company}</span>}{customer.phone&&<span>{customer.phone}</span>}{customer.email&&<span>{customer.email}</span>}</div></div>
      <div className="customer-balance"><span>Outstanding</span><strong>${outstanding.toFixed(2)}</strong></div>
    </section>

    <section className="detail-grid">
      <article className="detail-card properties-card"><div className="detail-card-head"><div><p className="eyebrow">Properties</p><h2>Service locations</h2></div>{canWrite(business.role)&&<button className="secondary-button small-button" onClick={()=>setShowProperty(true)}>+ Add property</button>}</div>
        {detail.properties.length===0?<p className="quiet">No property addresses yet.</p>:<div className="property-list">{detail.properties.map((item)=><div className="property-item" key={item.id}><strong>{item.label||'Property'}</strong><span>{item.address_line1}{item.address_line2?`, ${item.address_line2}`:''}</span><span>{[item.city,item.state,item.postal_code].filter(Boolean).join(', ')}</span>{item.access_notes&&<small>{item.access_notes}</small>}<div className="property-map-actions"><GoogleMapTools address={item} preview compact /></div></div>)}</div>}
      </article>
      <article className="detail-card"><p className="eyebrow">Snapshot</p><h2>Customer history</h2><div className="mini-metrics"><div><strong>{detail.jobs.length}</strong><span>Jobs</span></div><div><strong>{detail.estimates.length}</strong><span>Estimates</span></div><div><strong>{detail.invoices.length}</strong><span>Invoices</span></div></div>{customer.notes&&<p className="customer-notes">{customer.notes}</p>}</article>
    </section>

    <section className="detail-card"><div className="detail-card-head"><div><p className="eyebrow">Work history</p><h2>Jobs</h2></div></div>{detail.jobs.length===0?<p className="quiet">No jobs yet.</p>:<div className="history-list">{detail.jobs.map((job)=><div className="history-row" key={job.id}><div className="row-main"><strong>{job.title}</strong><span>{job.scheduled_start?new Date(job.scheduled_start).toLocaleDateString():'Not scheduled'}{job.description?` · ${job.description}`:''}</span></div><span className={`status-chip ${job.status}`}>{job.status.replaceAll('_',' ')}</span></div>)}</div>}</section>

    <section className="detail-grid">
      <article className="detail-card"><div className="detail-card-head"><div><p className="eyebrow">Quotes</p><h2>Estimates</h2></div></div>{detail.estimates.length===0?<p className="quiet">No estimates yet.</p>:<div className="history-list">{detail.estimates.map((estimate)=><div className="history-row compact-history" key={estimate.id}><div className="row-main"><strong>{estimate.estimate_number||'Estimate'}</strong><span>{estimate.status}</span></div><strong>${Number(estimate.total).toFixed(2)}</strong></div>)}</div>}</article>
      <article className="detail-card"><div className="detail-card-head"><div><p className="eyebrow">Billing</p><h2>Invoices</h2></div></div>{detail.invoices.length===0?<p className="quiet">No invoices yet.</p>:<div className="history-list">{detail.invoices.map((invoice)=><div className="history-row compact-history" key={invoice.id}><div className="row-main"><strong>{invoice.invoice_number||'Invoice'}</strong><span>{invoice.status} · ${Number(invoice.balance_due).toFixed(2)} due</span></div><strong>${Number(invoice.total).toFixed(2)}</strong></div>)}</div>}</article>
    </section>

    {showProperty&&<div className="modal-backdrop" onMouseDown={()=>setShowProperty(false)}><section className="modal" onMouseDown={(e)=>e.stopPropagation()}><div className="modal-head"><div><p className="eyebrow">Property</p><h2>Add service location</h2></div><button className="icon-button" onClick={()=>setShowProperty(false)}>×</button></div><form className="form-grid" onSubmit={addProperty}>
      <label className="full">Label<input value={property.label} onChange={(e)=>setProperty({...property,label:e.target.value})} placeholder="Home, Rental, Shop…"/></label>
      <label className="full">Street address<input value={property.address_line1} onChange={(e)=>setProperty({...property,address_line1:e.target.value})} required/></label>
      <label className="full">Address line 2<input value={property.address_line2} onChange={(e)=>setProperty({...property,address_line2:e.target.value})}/></label>
      <label>City<input value={property.city} onChange={(e)=>setProperty({...property,city:e.target.value})}/></label>
      <label>State<input value={property.state} onChange={(e)=>setProperty({...property,state:e.target.value})}/></label>
      <label>ZIP<input value={property.postal_code} onChange={(e)=>setProperty({...property,postal_code:e.target.value})}/></label>
      <label className="full">Access notes<textarea value={property.access_notes} onChange={(e)=>setProperty({...property,access_notes:e.target.value})} placeholder="Gate code, parking, lockbox…"/></label>
      {error&&<p className="form-message error-text full">{error}</p>}
      <div className="modal-actions full"><button type="button" className="secondary-button" onClick={()=>setShowProperty(false)}>Cancel</button><button className="primary-button" disabled={busy}>{busy?'Saving…':'Add property'}</button></div>
    </form></section></div>}
  </div>
}

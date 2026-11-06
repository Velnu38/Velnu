import {useAssistantRefresh} from '../lib/useAssistantRefresh'
import {readableError} from '../lib/errors'
import CustomerEditDialog from './CustomerEditDialog'
import {type DocumentDates} from './DocumentRecord'
import {canAccess} from '../lib/workspaceAccess'
import { useEffect, useRef, useState } from 'react'
import { canWrite, type CurrentBusiness } from '../lib/business'
import { getCustomerDetail } from '../services/customerDetail'
import type { CustomerLocation } from '../services/properties'
import ServiceLocationDialog from './ServiceLocationDialog'
import { customerRecordsHref } from '../lib/customerRecords'
import GoogleMapTools from './GoogleMapTools'

type Customer = { id:string; first_name:string|null; last_name:string|null; company:string|null; email:string|null; phone:string|null; notes:string|null }
type Property = CustomerLocation
type Job = { id:string; title:string; status:string; scheduled_start:string|null; completed_at:string|null; description:string|null }
type Estimate = DocumentDates & { id:string; estimate_number:string|null; status:string; total:number; issue_date:string; expires_on:string|null }
type Invoice = DocumentDates & { id:string; invoice_number:string|null; status:string; total:number; amount_paid:number; balance_due:number; issue_date:string; due_date:string|null }

type Detail = { customer:Customer; properties:Property[]; jobs:Job[]; estimates:Estimate[]; invoices:Invoice[] }

function displayName(customer: Customer) {
  return [customer.first_name, customer.last_name].filter(Boolean).join(' ') || customer.company || 'Customer'
}

export default function CustomerDetail({ business, customerId, onBack }: { business:CurrentBusiness; customerId:string; onBack:()=>void }) {
  const [detail,setDetail]=useState<Detail|null>(null)
  const [loading,setLoading]=useState(true)
  const [showAddress,setShowAddress]=useState(false),[editingAddress,setEditingAddress]=useState<CustomerLocation|undefined>(),[showEdit,setShowEdit]=useState(false)
  const [error,setError]=useState('')

  const request=useRef(0)
  const billing=canAccess(business,'billing'),jobs=canAccess(business,'jobs')
  async function refresh(){const current=++request.current;setLoading(true);setError('');try{const next=await getCustomerDetail(business.id,customerId,{billing,jobs}) as Detail;if(current===request.current)setDetail(next)}catch(e){if(current===request.current)setError(e instanceof Error?e.message:'Unable to load customer records.')}finally{if(current===request.current)setLoading(false)}}
  useAssistantRefresh(refresh,e=>setError(readableError(e,'The saved change could not refresh. Reload the list; do not repeat the save.')))
  useEffect(()=>{setDetail(null);void refresh();return()=>{request.current++}},[business.id,customerId,billing,jobs])
  if(loading&&!detail)return <div className="detail-loading">Loading customer…</div>
  if(!detail)return <div className="empty-state"><h2>Customer unavailable</h2>{error&&<p role="alert">{error}</p>}<button type="button" className="secondary-button" onClick={()=>void refresh()}>Retry customer history</button><button className="secondary-button" onClick={onBack}>Back to customers</button></div>
  const {customer}=detail
  const outstanding=detail.invoices.filter(invoice=>['sent','viewed','partial','overdue'].includes(invoice.status)).reduce((sum,invoice)=>sum+Number(invoice.balance_due||0),0)

  return <div className="page-stack">
    <div className="detail-top"><button className="back-button" onClick={onBack}>← Customers</button></div>
    <section className="customer-hero" aria-label="Customer contact">
      <div className="avatar large">{displayName(customer).charAt(0).toUpperCase()}</div>
      <div className="customer-hero-main"><p className="eyebrow">Customer</p><h1>{displayName(customer)}</h1><div className="customer-contact">{customer.company&&displayName(customer)!==customer.company&&<span>{customer.company}</span>}{customer.phone&&<span>{customer.phone}</span>}{customer.email&&<span>{customer.email}</span>}</div></div>
      {billing&&<div className="customer-balance"><span>Outstanding</span><strong>${outstanding.toFixed(2)}</strong></div>}
      {canWrite(business.role)&&<div className="customer-contact-actions"><button type="button" className="secondary-button compact" onClick={()=>setShowEdit(true)}>Edit customer</button></div>}
    <div className="customer-contact-address" role="group" aria-label="Address">
      <div className="detail-card-head"><div><h2>Address</h2><p className="quiet">Service locations, maps and directions for this contact.</p></div>{canWrite(business.role)&&<button type="button" className="secondary-button compact" onClick={()=>{setEditingAddress(undefined);setShowAddress(true)}}>+ Add address</button>}</div>
      {detail.properties.length===0?<p className="quiet">No address added. Add an address for this contact or a service location.</p>:<div className="property-list">{detail.properties.map(item=><article className="property-item" key={item.id}>
        <div className="customer-address-head"><strong>{item.label||'Service address'}</strong>{canWrite(business.role)&&<button type="button" className="text-button" aria-label={`Edit address ${item.address_line1}`} onClick={()=>{setEditingAddress(item);setShowAddress(true)}}>Edit address</button>}</div>
        <span>{item.address_line1}{item.address_line2?`, ${item.address_line2}`:''}</span><span>{[item.city,item.state,item.postal_code].filter(Boolean).join(', ')}</span>
        {item.access_notes&&<small>{item.access_notes}</small>}<div className="property-map-actions"><GoogleMapTools address={item} preview compact /></div>
      </article>)}</div>}
    </div>
    </section>
    {showEdit&&<CustomerEditDialog businessId={business.id} customerId={customerId} onClose={()=>setShowEdit(false)} onSaved={()=>void refresh()} onDeleted={onBack}/>}
    {error&&<p role="alert" className="form-message error-text">{error}</p>}
    <section className="detail-card customer-snapshot" aria-label="Customer snapshot">
      <p className="eyebrow">Snapshot</p><h2>Customer snapshot</h2>
      <div className="mini-metrics customer-record-actions">
        {jobs&&<a href={customerRecordsHref('work',customerId)} aria-label={`View jobs for ${displayName(customer)}`}><strong>{detail.jobs.length}</strong><span>Jobs <span aria-hidden="true">→</span></span></a>}
        {billing&&<><a href={customerRecordsHref('estimates',customerId)} aria-label={`View estimates for ${displayName(customer)}`}><strong>{detail.estimates.length}</strong><span>Estimates <span aria-hidden="true">→</span></span></a>
        <a href={customerRecordsHref('invoices',customerId)} aria-label={`View invoices for ${displayName(customer)}`}><strong>{detail.invoices.length}</strong><span>Invoices <span aria-hidden="true">→</span></span></a></>}
      </div>
      {customer.notes&&<p className="customer-notes">{customer.notes}</p>}
    </section>
    {showAddress&&<ServiceLocationDialog businessId={business.id} customerId={customerId} location={editingAddress} onClose={()=>setShowAddress(false)} onSaved={()=>void refresh()}/>}
  </div>
}

import {useEffect,useMemo,useRef,useState,type FormEvent} from 'react'
import type {CurrentBusiness} from '../lib/business'
import {canManageFinances} from '../lib/business'
import {parseVoiceDocument,type VoiceKind,type VoiceLine,type VoiceSeed} from '../lib/voiceDocument'
import {getDocumentSettings,type DocumentSettings} from '../services/settings'
import {previewDocumentTotal,validDecimal} from '../lib/financialValidation'
import {listCustomers,updateCustomerContact} from '../services/customers'
import {createInvoice} from '../services/invoices'
import {useUnsavedChanges} from '../lib/unsavedChanges'
import {createEstimate} from '../services/estimates'
import {newCustomerFields} from './CustomerEntry'
import {customerActionsEnabled} from '../lib/releaseFlags'
import {normalizeMobile} from '../lib/smsPhone'
import {sendReviewedDocument,type ReviewDeliveryReceipt} from '../services/reviewDelivery'
type Customer={id:string;first_name:string|null;last_name:string|null;company:string|null;email?:string|null;phone?:string|null;updated_at?:string}
type SavedDocument={id:string;invoice_number?:string|null;estimate_number?:string|null;balance_due?:number;total?:number}
const customerLabel=(c:Customer)=>[c.first_name,c.last_name].filter(Boolean).join(' ')||c.company||'Unnamed customer'
const blank=():VoiceLine=>({description:'',amount:'',quantity:'1'})
export default function QuickInvoiceReview({business,command,initialSeed,parserNotice,onCancel,onSaved}:{business:CurrentBusiness;command:string;initialSeed?:VoiceSeed;parserNotice?:string;onCancel:()=>void;onSaved:(document:SavedDocument,kind:VoiceKind,delivery?:ReviewDeliveryReceipt)=>void}){
 const seed=useMemo(()=>initialSeed??parseVoiceDocument(command),[command,initialSeed]),kind=seed.kind
 const [customers,setCustomers]=useState<Customer[]>([]),[loading,setLoading]=useState(true),[customerId,setCustomerId]=useState(''),[defaults,setDefaults]=useState<DocumentSettings|null>(null)
 const [customerMode,setCustomerMode]=useState<'choose'|'new'>(seed.customerName?'new':'choose')
 const [customerName,setCustomerName]=useState(seed.customerName),[lines,setLines]=useState(seed.lines),[quantities,setQuantities]=useState(seed.lines.some(l=>Number(l.quantity)!==1))
 const [taxRate,setTaxRate]=useState(seed.taxRate??'0'),[taxVisible,setTaxVisible]=useState(seed.taxRate===''||Number(seed.taxRate)>0),[dueDate,setDueDate]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('')
 useUnsavedChanges(busy)
 const [email,setEmail]=useState(''),[phone,setPhone]=useState(''),[contactOpen,setContactOpen]=useState(false)
 const [saved,setSaved]=useState<SavedDocument|null>(null),[sending,setSending]=useState(false)
 const sendId=useRef(crypto.randomUUID())
 const selected=customers.find(c=>c.id===customerId)
 useEffect(()=>{setEmail(selected?.email||'');setPhone(selected?.phone||'')},[customerId,selected?.email,selected?.phone])
 const emailValid=/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(email.trim()),phoneValid=!!normalizeMobile(phone)
 const contactsValid=(!email.trim()||emailValid)&&(!phone.trim()||phoneValid||phone===(selected?.phone||''))
 const [statedTotal,setStatedTotal]=useState(seed.statedTotal)
 const saving=useRef(false),customerRetry=useRef<{name:string;id:string}|null>(null),retry=useRef<{signature:string;id:string}|null>(null)
 useEffect(()=>{let active=true;void Promise.all([listCustomers(business.id),getDocumentSettings(business.id)]).then(([rows,settings])=>{
  if(!active)return;setDefaults(settings);const tax=seed.taxRate??String(settings.default_tax_rate);setTaxRate(tax);setTaxVisible(tax===''||Number(tax)>0)
  const data=rows as Customer[];setCustomers(data);const match=data.find(c=>customerLabel(c).trim().toLowerCase()===seed.customerName.toLowerCase());if(match)setCustomerId(match.id)
 }).catch(e=>{if(active)setError((e as Error).message)}).finally(()=>{if(active)setLoading(false)});return()=>{active=false}},[business.id,command])
 const items=lines.map(l=>({description:l.description.trim(),quantity:Number(l.quantity),unit_price:l.amount.trim()===''?NaN:Number(l.amount),tax_rate:Number(taxRate)}))
 const total=previewDocumentTotal(items),mismatch=statedTotal!==null&&total!==null&&(statedTotal===''||Math.round(Number(statedTotal)*100)!==Math.round(total*100))
 const valid=items.length>0&&items.length<=50&&items.every(i=>i.description&&validDecimal(i.unit_price,0,10000000)&&validDecimal(i.quantity,0.01,100000))&&taxRate.trim()!==''&&validDecimal(Number(taxRate),0,100)&&total!==null&&(!!customerId||(customerMode==='new'&&!!customerName.trim()))
 const change=(index:number,key:keyof VoiceLine,value:string)=>setLines(prev=>prev.map((l,i)=>i===index?{...l,[key]:value}:l))
 async function saveDraft(e:FormEvent){e.preventDefault();await save(false)}
 async function save(sendEmail:boolean){if(saving.current||loading||!defaults||!canManageFinances(business.role))return
  if(!valid||mismatch||!contactsValid){setError('Check each description, amount and the calculated total before saving.');return}
  if(!customerId&&!customerName.trim()){setError('Choose a customer or enter a customer name.');return}
  if(sendEmail&&(!emailValid||!customerActionsEnabled))return
  saving.current=true;setBusy(true);setSending(sendEmail);setError('');try{
   if(!saved&&selected&&(email.trim()!==(selected.email||'')||phone.trim()!==(selected.phone||''))){
    if(!selected.updated_at)throw new Error('Reload the customer before updating their contact details.')
    const updated=await updateCustomerContact(business.id,selected.id,selected.updated_at,email.trim(),phone.trim());setCustomers(rows=>rows.map(c=>c.id===updated.id?updated:c))
   }
   if(customerRetry.current?.name!==customerName.trim())customerRetry.current={name:customerName.trim(),id:crypto.randomUUID()}
   const chosen=customerId||customerRetry.current.id,input={customer_id:chosen,...(!customerId?{new_customer:newCustomerFields({name:customerName,email,phone})}:{}),items,...(kind==='invoice'?{due_date:dueDate||undefined}:{expires_on:dueDate||undefined})}
   const signature=JSON.stringify({kind,...input});if(retry.current?.signature!==signature)retry.current={signature,id:crypto.randomUUID()}
   const document=saved??(kind==='invoice'?await createInvoice(business.id,{...input,request_id:retry.current.id}):await createEstimate(business.id,{...input,request_id:retry.current.id}))
   setSaved(document)
   if(sendEmail){
    const receipt=await sendReviewedDocument(business.id,kind,document.id,email.trim(),sendId.current)
    onSaved(document,kind,receipt)
   }else onSaved(document,kind)
  }catch(e){setError(e instanceof Error?e.message:'Could not complete this action. Your entered details are preserved.')}finally{saving.current=false;setBusy(false);setSending(false)}
 }
 return <section className="quick-invoice-review" aria-label={`Review ${kind} draft`} data-saving={busy?'true':undefined}>
 <p className="eyebrow">Fin · {kind} draft</p>
 <details className="voice-original"><summary>Your request</summary><p className="quick-invoice-original">{command}</p>{parserNotice&&<p className="quick-invoice-note">{parserNotice}</p>}</details>
 {seed.warnings.length>0&&<p className="form-message" role="note">{seed.warnings.join(' ')}</p>}
 <form onSubmit={saveDraft} className="quick-invoice-fields"><fieldset disabled={busy} className="form-dialog-fields">
 <fieldset className="form-dialog-fields" disabled={!!saved}><label>Customer<select value={customerId||(customerMode==='new'?'__new__':'')} disabled={loading} onChange={e=>{const v=e.target.value;setCustomerId(v==='__new__'?'':v);setCustomerMode(v==='__new__'?'new':'choose');setError('')}}><option value="">Choose a customer</option>{customers.map(c=><option key={c.id} value={c.id}>{customerLabel(c)}</option>)}<option value="__new__">Create a new customer</option></select></label>
 {!customerId&&customerMode==='choose'&&<p className="form-message">Who is this for? Choose a customer. Your charges and total are ready below.</p>}
 {!customerId&&customerMode==='new'&&<label>New customer name or company<input value={customerName} onChange={e=>setCustomerName(e.target.value)} required maxLength={160}/></label>}
 <details className="voice-contact-details" open={contactOpen} onToggle={e=>setContactOpen(e.currentTarget.open)}><summary>{email.trim()||phone.trim()?'Customer contact details':'Add email or phone to send (optional)'}</summary>
 <div className="form-grid"><label>Customer email<input type="email" value={email} autoComplete="email" maxLength={254} onChange={e=>setEmail(e.target.value)}/></label><label>Customer phone<input type="tel" value={phone} autoComplete="tel" maxLength={40} onChange={e=>setPhone(e.target.value)}/></label></div>
 <p className="quiet">Contact changes are saved to this customer when you save the document.</p>
 {!contactsValid&&<p className="form-message error-text">Check the email or phone number, or leave it blank to save a draft.</p>}</details>
 <div className="voice-line-list" aria-label="Charge lines">
 {lines.map((l,i)=><div className="voice-charge" role="group" aria-label={`Line ${i+1}`} key={i}>
 <div className="voice-line-heading"><strong>Line {i+1}</strong><button type="button" className="text-button" aria-label={`Remove charge line ${i+1}`} disabled={lines.length===1} onClick={()=>setLines(prev=>prev.filter((_,n)=>n!==i))}>Remove</button></div>
 <div className="voice-line-fields"><label>Description<input aria-label={lines.length===1?'Work performed / line-item description':`Line ${i+1} description`} value={l.description} onChange={e=>change(i,'description',e.target.value)} required maxLength={2000}/></label>
 <label>{quantities?'Unit price ($)':'Amount ($)'}<input aria-label={lines.length===1?'Amount ($)':`Line ${i+1} amount ($)`} inputMode="decimal" type="number" min="0" max="10000000" step="0.01" value={l.amount} onChange={e=>change(i,'amount',e.target.value)} required/></label></div>
 {quantities&&<div className="voice-unit-fields"><label>Quantity<input aria-label={`Line ${i+1} quantity`} inputMode="decimal" type="number" min="0.01" max="100000" step="0.01" value={l.quantity} onChange={e=>change(i,'quantity',e.target.value)} required/></label><p className="quiet">{l.quantity} × ${Number(l.amount||0).toFixed(2)} = ${(Number(l.quantity)*Number(l.amount||0)).toFixed(2)} before tax</p></div>}
 </div>)}
 </div><button className="text-button left" type="button" disabled={lines.length>=50} onClick={()=>setLines(l=>[...l,blank()])}>+ Add line</button>
 <details className="voice-extra-options" open={taxVisible||quantities}><summary>More options</summary><div className="voice-optional-fields"><button className="text-button left" type="button" aria-pressed={quantities} disabled={quantities&&lines.some(l=>Number(l.quantity)!==1)} onClick={()=>setQuantities(q=>!q)}>{quantities?'Hide quantities':'Use quantities'}</button>
 {!taxVisible?<button type="button" className="text-button left" onClick={()=>setTaxVisible(true)}>Add tax</button>:<div className="quick-invoice-money"><label>Tax (%)<input type="number" min="0" max="100" step="0.01" value={taxRate} onChange={e=>setTaxRate(e.target.value)} required/></label><button type="button" className="text-button" onClick={()=>{setTaxRate('0');setTaxVisible(false)}}>Remove tax</button></div>}
 <label>{kind==='invoice'?'Due date (optional)':'Expiration date (optional)'}<input type="date" value={dueDate} onChange={e=>setDueDate(e.target.value)}/></label></div></details>

 {mismatch&&<div className="form-message error-text" role="alert">Spoken total: {statedTotal===''?'needs review':'$'+Number(statedTotal).toFixed(2)}. It does not match the calculated total. Check the lines, or explicitly choose the calculated total.<button type="button" className="secondary-button" onClick={()=>setStatedTotal(null)}>Use calculated total</button></div>}
 </fieldset>
 <p className="quick-invoice-note">Review the customer, charges and total. Email saves this {kind} and sends it in one step. Save draft does not send anything.</p>
 {saved&&<p className="form-message">Your {kind} is saved. Email delivery is not confirmed. Retry below using the same document, or finish and check its activity before sending again.</p>}
 {error&&<p role="alert" className="form-message error-text">{error}</p>}
 <div className="voice-document-total" role="status"><span>Total</span><strong>{total===null?'Add missing amounts':'$'+total.toFixed(2)}</strong></div>
 <div className="voice-delivery-options" aria-label="Send this document">
 {email.trim()&&<div className="voice-delivery-option"><button type="button" className="primary-button" disabled={busy||loading||!defaults||!valid||mismatch||!contactsValid||!emailValid||!customerActionsEnabled||!canManageFinances(business.role)} onClick={()=>void save(true)}>{sending?'Saving and sending…':saved?'Retry email':`Email ${kind}`}</button><span>To: {email.trim()}</span>{!customerActionsEnabled&&<p className="quiet">Email sending is awaiting delivery setup. You can save a draft now.</p>}</div>}
 {phone.trim()&&<div className="voice-delivery-option"><button type="button" className="secondary-button" disabled aria-describedby="voice-sms-status">Text {kind}</button><span>To: {phone.trim()}</span><p id="voice-sms-status" className="quiet">{phoneValid?'Customer text delivery is awaiting SMS setup. This number will be saved with the customer.':'Enter a valid mobile number to use text delivery.'}</p></div>}
 {!email.trim()&&!phone.trim()&&<p className="quiet">Add an email or phone above to see delivery options, or save a draft.</p>}
 </div>
 <div className="preview-actions">{!saved&&<button type="button" className="secondary-button" onClick={onCancel}>Back</button>}<button type="submit" className={emailValid?'secondary-button':'primary-button'} disabled={busy||loading||!defaults||!valid||mismatch||!contactsValid||!canManageFinances(business.role)}>{busy&&!sending?'Saving draft…':saved?'Done — keep saved document':`Save draft ${kind}`}</button></div></fieldset></form></section>
}

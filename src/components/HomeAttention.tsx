import {useEffect,useRef,useState} from 'react'
import type {CurrentBusiness} from '../lib/business'
import {canManageFinances} from '../lib/business'
import {canAccess} from '../lib/workspaceAccess'
import {useBusinessRefresh} from '../lib/useBusinessRefresh'
import {getAttentionPage,type AttentionPage} from '../services/dashboardAttention'
import {getJobManagementPage,type ManagementPage} from '../services/jobManagement'
import {listCustomerPaymentReviews,type CustomerPaymentReview} from '../services/customerPaymentReviews'
import BillingHub from './BillingHub'
import OperationalAttention from './OperationalAttention'
import CustomerPaymentReviews from './CustomerPaymentReviews'
import WorkspaceIcon from './WorkspaceIcon'

type Result={key:string;billing:AttentionPage|null;work:ManagementPage|null;payments:CustomerPaymentReview[];errors:string[]}
/** A read-only entry to the existing authorized queues; actions stay in their original reviews. */
export default function HomeAttention({business,refreshVersion=0,approvalBreakdown,overdueAmount}:{business:CurrentBusiness;refreshVersion?:number;overdueAmount?:number;approvalBreakdown?:{estimates?:number;changeOrders?:number}}){
 const billing=canAccess(business,'billing')&&canManageFinances(business.role),work=canAccess(business,'jobs'),payments=canAccess(business,'finances')
 const [result,setResult]=useState<Result|null>(null),[revision,setRevision]=useState(0),[view,setView]=useState<'summary'|'billing'|'work'>(()=>work&&history.state?.finviantHome?.businessId===business.id&&history.state.finviantHome.panel==='work'?'work':billing&&history.state?.finviantAttention?.businessId===business.id?'billing':'summary')
 const generation=useRef(0),card=useRef<HTMLElement>(null),previousView=useRef(view)
 useEffect(()=>{if(previousView.current===view)return;const previous=previousView.current;previousView.current=view;card.current?.querySelector<HTMLElement>(view==='summary'?`button[data-home-panel="${previous}"]`:'.home-detail-back')?.focus()},[view])
 const key=JSON.stringify([business.id,business.role,business.access_modules,revision,refreshVersion])
 useBusinessRefresh(business.id,()=>setRevision(v=>v+1))
 useEffect(()=>{let active=true;const request=++generation.current
  void Promise.allSettled([billing?getAttentionPage(business.id,1,'attention'):Promise.resolve(null),work?getJobManagementPage(business.id,{filter:'attention',search:'',page:0}):Promise.resolve(null),payments?listCustomerPaymentReviews(business.id):Promise.resolve([])]).then(([b,w,p])=>{
   if(!active||request!==generation.current)return
   setResult({key,billing:b.status==='fulfilled'?b.value:null,work:w.status==='fulfilled'?w.value:null,payments:p.status==='fulfilled'?p.value:[],errors:[...(b.status==='rejected'?['Billing review is unavailable.']:[]),...(w.status==='rejected'?['Work blockers are unavailable.']:[]),...(p.status==='rejected'?['Payment review is unavailable.']:[])]})
  });return()=>{active=false}
 },[key])
 const data=result?.key===key?result:null,failed=!!data?.errors.length
 const total=data?Number(data.billing?.attention_count||0)+Number(data.work?.total||0):null
 const paymentProblem=payments&&!!(data?.payments.length||data?.errors.some(message=>message.startsWith('Payment review')))
 if(!billing&&!work&&!paymentProblem)return null
 if(view!=='summary')return <section ref={card} className="home-attention-expanded" onClickCapture={event=>{const link=(event.target as Element).closest('a[href^="/?view=work"]');if(view==='work'&&link&&event.button===0&&!event.ctrlKey&&!event.metaKey&&!event.shiftKey&&!event.altKey)history.replaceState({...history.state,finviantHome:{businessId:business.id,panel:'work'}},'',location.href)}}><button type="button" className="text-button home-detail-back" onClick={()=>{const {finviantAttention,finviantHome,...rest}=history.state||{};history.replaceState(rest,'',location.href);setView('summary')}}>‹ Back to Needs Attention</button>{view==='billing'?<>{billing&&<BillingHub business={business} refreshVersion={refreshVersion} approvalBreakdown={approvalBreakdown}/>} {payments&&<CustomerPaymentReviews businessId={business.id}/>}</>:<OperationalAttention business={business} refreshVersion={refreshVersion}/>}</section>
 return <section ref={card} className="dashboard-tile home-attention-card" aria-label="Needs attention overview" aria-busy={!data}>
  <div className="home-card-heading"><h2 className="dashboard-tile-title">Needs Attention</h2><span className="home-count" aria-label={!data?'Loading action counts':failed?'Some action counts unavailable':data.payments.length?'Payment review required':`${total} actions need review`}>{!data?'…':failed?'—':data.payments.length?'!':total}</span></div>
  <div className="home-action-grid">
   {(billing||paymentProblem)&&<button type="button" className="home-action-tile" data-home-panel="billing" onClick={()=>setView('billing')}><WorkspaceIcon kind="invoices"/><span aria-hidden="true" className="home-tile-chevron">›</span><strong>{billing?'Invoice review':'Payment review'}</strong><small>{!data?'Checking billing…':data.payments.length?'Payment review required':data.billing?(overdueAmount!==undefined&&overdueAmount>0?`${new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(overdueAmount)} overdue`:data.billing.attention_count?`${data.billing.attention_count} to review`:data.billing.approval_count?`${data.billing.approval_count} awaiting approval`:'No billing actions due'):data.errors.some(message=>message.startsWith('Billing review'))?'Billing review unavailable':'Open payment review'}</small></button>}
   {work&&<button type="button" className="home-action-tile" data-home-panel="work" onClick={()=>setView('work')}><WorkspaceIcon kind="work"/><span aria-hidden="true" className="home-tile-chevron">›</span><strong>Work blockers</strong><small>{!data?'Checking jobs…':data.work?`${data.work.total} ${data.work.total===1?'job needs':'jobs need'} review`:'Work review unavailable'}</small></button>}
  </div>
  {failed&&<p role="alert">{data.errors.join(' ')} <button type="button" className="text-button" onClick={()=>setRevision(v=>v+1)}>Retry reviews</button></p>}
 </section>
}

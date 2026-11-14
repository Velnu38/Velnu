import assert from 'node:assert/strict'
import test from 'node:test'
import {jobJourney,verifiedJourney,type JourneyFacts} from '../../src/lib/jobJourney.ts'
import {jobNextStep} from '../../src/lib/jobNextStep.ts'
const facts=(p:Partial<JourneyFacts>={}):JourneyFacts=>({workStatus:'lead',approval:'approved',deposit:'not_required',hasVisit:false,remainingVisits:0,unfinishedTasks:0,missingMaterials:0,pendingChanges:0,pricingAgreed:true,billingVisible:true,invoice:null,payment:'none',delivery:'none',...p})
test('the fixed-price reference journey advances through approval, booking, work, invoice review and verified settlement',()=>{
 const f=facts({approval:'pending'});assert.equal(jobJourney(f).stage,'approval')
 f.approval='approved';assert.equal(jobJourney(f).stage,'scheduling')
 f.hasVisit=true;f.workStatus='scheduled';assert.equal(jobJourney(f).stage,'booked')
 f.workStatus='in_progress';f.unfinishedTasks=1;assert.equal(jobJourney(f).stage,'working')
 f.unfinishedTasks=0;assert.equal(jobJourney(f).stage,'completion_review')
 f.workStatus='completed';f.invoice={id:'final',status:'draft',balanceDue:2200};assert.equal(jobJourney(f).stage,'invoice_review')
 f.invoice.status='sent';f.delivery='queued';assert.equal(jobJourney(f).stage,'delivery')
 f.delivery='accepted';assert.equal(jobJourney(f).stage,'payment')
 f.invoice.status='partial';f.invoice.balanceDue=1200;assert.equal(jobJourney(f).label,'Partially paid')
 f.invoice.status='paid';f.invoice.balanceDue=0;assert.equal(jobJourney(f).stage,'closed')
})
test('a deposit never completes work; existing booked work is not automatically canceled for a deposit exception',()=>{
 assert.equal(jobJourney(facts({deposit:'unpaid'})).stage,'deposit')
 assert.equal(jobJourney(facts({deposit:'paid'})).stage,'scheduling')
 assert.equal(jobJourney(facts({deposit:'unpaid',hasVisit:true,workStatus:'scheduled'})).stage,'booked')
 assert.equal(jobJourney(facts({hasVisit:true,workStatus:'in_progress',invoice:{id:'paid-final',status:'paid',balanceDue:0}})).stage,'completion_review')
})
test('pending or uncertain payment cannot close a job or invite another collection attempt',()=>{
 const invoice={id:'final',status:'sent' as const,balanceDue:1200}
 assert.equal(jobJourney(facts({workStatus:'completed',invoice,payment:'pending'})).stage,'payment_pending')
 assert.equal(jobJourney(facts({workStatus:'completed',invoice,payment:'review'})).action,'reconcile')
 assert.equal(jobJourney(facts({workStatus:'completed',invoice:{...invoice,status:'paid',balanceDue:0},payment:'review'})).stage,'payment_review')
})
test('refunds and inconsistent balances reopen financial review without reopening work',()=>{
 const f=facts({workStatus:'completed',invoice:{id:'final',status:'partial',balanceDue:500}})
 assert.equal(jobJourney(f).stage,'payment');assert.equal(jobJourney(f).workComplete,true);assert.equal(jobJourney(f).financiallySettled,false)
 f.invoice!.balanceDue=0;assert.equal(jobJourney(f).stage,'payment_review')
 f.invoice!.balanceDue=Number.NaN;assert.equal(jobJourney(f).action,'reconcile')
})
test('unresolved visits and changes prevent financial closure, and manual costs do not invent agreed pricing',()=>{
 assert.equal(jobJourney(facts({workStatus:'completed',remainingVisits:1,invoice:{id:'final',status:'paid',balanceDue:0}})).stage,'completion_review')
 assert.equal(jobJourney(facts({workStatus:'completed',pendingChanges:1})).stage,'completion_review')
 assert.equal(jobJourney(facts({workStatus:'completed',pricingAgreed:false})).stage,'pricing')
})
test('delivery uncertainty and cancellation retain an explicit review path',()=>{
 assert.equal(jobJourney(facts({workStatus:'completed',invoice:{id:'final',status:'sent',balanceDue:100},delivery:'uncertain'})).action,'delivery')
 const canceled=jobJourney(facts({workStatus:'canceled',invoice:{id:'final',status:'partial',balanceDue:100}}));assert.equal(canceled.stage,'canceled');assert.equal(canceled.needsAttention,true);assert.equal(canceled.action,'invoice')
})
test('staff without billing access see work completion without financial status or a financial action',()=>{
 const v=jobJourney(facts({workStatus:'completed',billingVisible:false,invoice:{id:'secret',status:'paid',balanceDue:0}}));assert.equal(v.stage,'work_complete');assert.equal(v.action,'history');assert.equal(v.financiallySettled,false)
})
test('malformed server facts cannot certify progress and office next actions honor approvals, deposits and payment review',()=>{
 assert.equal(verifiedJourney({}),undefined);assert.equal(verifiedJourney(facts({remainingVisits:-1})),undefined);assert.equal(verifiedJourney(facts({invoice:{id:'bad',status:'paid',balanceDue:Number.NaN}})),undefined);assert.ok(verifiedJourney(facts()))
 const p={status:'lead',ready:true,canEdit:true,canSchedule:true,canBill:true,booked:false,crew:false,futureVisit:false,remainingVisits:false,tasks:0,materials:0,changes:0}
 assert.equal(jobNextStep({...p,journey:facts({approval:'pending',estimateId:'estimate'})}).action,'estimate')
 assert.equal(jobNextStep({...p,journey:facts({deposit:'unpaid',depositInvoiceId:'deposit'})}).action,'deposit')
 assert.equal(jobNextStep({...p,status:'completed',journey:facts({workStatus:'completed',payment:'review'})}).label,'Review payment outcome')
 assert.equal(jobNextStep({...p,status:'completed',canBill:false,journey:facts({workStatus:'completed',payment:'review'})}).action,'history')
})

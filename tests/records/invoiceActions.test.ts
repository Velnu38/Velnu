import assert from 'node:assert/strict'
import test from 'node:test'
import {invoiceActionPolicy,invoiceDisplayStatus,invoiceIsOverdue} from '../../src/lib/invoiceActions.ts'

const today='2026-11-08'
const context={today,canManage:true,paymentState:'clear' as const,recovery:false}
const invoice=(status:string,extra={})=>({status,balance_due:100,amount_paid:0,due_date:'2026-11-30',...extra})
test('all seven invoice states receive at most one primary and one meaningful secondary',()=>{
  const rows=[
    ['draft','send','edit'],['sent','mark_paid',null],['viewed','mark_paid',null],['partial','mark_paid',null],
    ['overdue','reminder','mark_paid'],['paid',null,null],['void',null,null],
  ] as const
  for(const [status,primary,secondary] of rows){
    const item=invoice(status,status==='partial'?{amount_paid:25,balance_due:75}:status==='paid'?{amount_paid:100,balance_due:0}:{})
    const result=invoiceActionPolicy(item,context)
    assert.equal(result.primary,primary,status)
    assert.equal(result.secondary,secondary,status)
    if(status==='paid'||status==='void')assert.equal(result.canRecordPayment,false)
  }
})
test('overdue partial invoices use reminder plus Mark Paid without losing received funds',()=>{
  const item=invoice('partial',{amount_paid:25,balance_due:75,due_date:'2026-11-01'})
  const result=invoiceActionPolicy(item,context)
  assert.equal(invoiceDisplayStatus(item,today),'Overdue')
  assert.equal(result.primary,'reminder')
  assert.equal(result.secondary,'mark_paid')
  assert.equal(result.canVoid,false)
})
test('zero drafts and void records never appear paid or overdue',()=>{
  for(const status of ['draft','void']){
    const item=invoice(status,{balance_due:0,due_date:'2020-01-01'})
    assert.equal(invoiceDisplayStatus(item,today),status==='draft'?'Draft':'Void')
    assert.equal(invoiceIsOverdue(item,today),false)
  }
  assert.equal(invoiceDisplayStatus(invoice('sent',{balance_due:0}),today),'Paid')
  const unknown=invoiceActionPolicy(invoice('unknown_future_state'),context)
  assert.equal(unknown.canRecordPayment,false)
  assert.equal(unknown.canVoid,false)
})
test('pending or unverified payment operations block duplicate receipts, collection reminders and void',()=>{
  for(const paymentState of ['pending','review_required','unavailable'] as const){
    const result=invoiceActionPolicy(invoice('overdue'),{...context,paymentState})
    assert.equal(result.primary,null)
    assert.equal(result.canRecordPayment,false)
    assert.equal(result.canRemind,false)
    assert.equal(result.canVoid,false)
    assert.equal(result.canSendCopy,true,'owner can still share its issued record')
  }
})
test('finance role/module and pending delivery recovery govern mutations without changing tier entitlements',()=>{
  for(const status of ['draft','sent','viewed','partial','paid','overdue','void']){
    const result=invoiceActionPolicy(invoice(status),{...context,canManage:false})
    assert.equal(result.primary,null)
    assert.equal(result.secondary,null)
    assert.equal(result.canRecordPayment,false)
    assert.equal(result.canVoid,false)
    assert.equal(result.canSendCopy,false)
  }
  const pending=invoiceActionPolicy(invoice('draft'),{...context,recovery:true})
  assert.equal(pending.primary,null,'delivery recovery is handled outside More before starting a new send')
  assert.equal(pending.secondary,null)
})

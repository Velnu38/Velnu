import {customerSearchResponse} from './job-customer-fixture.mjs'
import {mockJobDirectory} from './job-directory-fixture.mjs'
import { createWork, openWorkArea } from './navigation.mjs'
import {attentionPage} from './attention-fixture.mjs'
import { test, expect } from '@playwright/test'
import { DateTime } from 'luxon'
import { fulfillPdf, PDF_REVISION } from './document-pdf-fixture.mjs'

// Mock-only integration tests. No production login, email, billing, or database writes.
// The existing Playwright config supplies the fake Supabase URL.
const BID = '11111111-1111-4111-8111-111111111111'
const UID = '33333333-3333-4333-8333-333333333333'
const CID = '44444444-4444-4444-8444-444444444444'
const AID = '55555555-5555-4555-8555-555555555555'
const user = { id: UID, email: 'qa-owner@example.test', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' }
const customer = { id: CID, first_name: 'Jane', last_name: 'Doe', company: null }
const business = { id: BID, name: 'Velnu QA', created_by_user_id: UID, legal_name: null, role: 'owner', profile_completed_at: '2026-10-01T00:00:00Z', document_accent: '#2563eb', logo_path: null }
const id = n => '88888888-8888-4888-8888-' + String(n).padStart(12, '0')
const todayISO = () => new Date().toISOString().slice(0, 10)
const receiptDay = () => DateTime.now().setZone('America/New_York').toISODate()
const localDatetime = (offsetDays = 1, hours = 10, minutes = 0) => {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  d.setHours(hours, minutes, 0, 0)
  const two = x => String(x).padStart(2, '0')
  return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate()) + 'T' + two(d.getHours()) + ':' + two(d.getMinutes())
}
const appointment = (n = 1) => ({
  id: id(n), title: 'Visit ' + n,
  starts_at: new Date(Date.now() + 86400000).toISOString(),
  ends_at: null, status: 'scheduled', customer_id: CID,
  customers: customer, jobs: null,
})
const reminder = (n = 1) => ({
  id: id(n), kind: 'invoice_follow_up', due_at: new Date(Date.now() - 3600000).toISOString(),
  note: 'Call customer ' + n, status: 'pending', invoice_id: null, estimate_id: null,
  job_id: null, customer_id: CID,
})

async function mockWorkspace(page, options = {}) {
  const sessionTTL=options.sessionTTL || 3600
  const sessionNow=options.now ?? Date.now()
  const sessionHeader = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const sessionBody = Buffer.from(JSON.stringify({ sub: UID, aud: 'authenticated', role: 'authenticated', exp: Math.floor(sessionNow / 1000) + sessionTTL })).toString('base64url')
  const session = { access_token: sessionHeader + '.' + sessionBody + '.test', refresh_token: 'refresh', expires_at: Math.floor(sessionNow / 1000) + sessionTTL, expires_in: sessionTTL, token_type: 'bearer', user }
  await page.addInitScript(s => localStorage.setItem('sb-example-auth-token', JSON.stringify(s)), session)

  const state = {
    role: options.role || 'owner',
    customers: options.customers || [customer],
    jobs: options.jobs || [],
    appointments: [...(options.appointments || [])],
    reminders: [...(options.reminders || [])],
    invoices: [...(options.invoices || [])],
    estimates: [...(options.estimates || [])],
    changeOrders: [...(options.changeOrders || [])],
    attentionNow: options.attentionNow,
    workflow: options.workflow || {approved:[],completed:[]}, attentionFailure:false, attentionDelay:0,
    requests: [],
    photos: [], expenses: [], photoLoadFailures: options.photoLoadFailures || 0, storageWrites: 0, uploadedReceipts: new Set(), receiptUploadFailures: options.receiptUploadFailures || 0,
    savedJobs: new Map(),
    aggregate: options.aggregate ?? { open_invoices: 0, outstanding_balance: 0 },
    aggregateFailures: options.aggregateFailures || 0,
    aggregateDelay: options.aggregateDelay || 0,
    jobError: options.jobError || false,
    appointmentError: options.appointmentError || false,
    reminderError: options.reminderError || false,
    appointmentPatchError: options.appointmentPatchError || false,
  }
  await page.route('https://example.supabase.co/**', async route => {
    const req = route.request()
    const url = new URL(req.url())
    const path = url.pathname
    const method = req.method()
    let body
    try { body = req.postDataJSON() } catch { body = null }
    state.requests.push({ path, method, url: url.toString(), body })
    const reply = (value, status = 200, total = Array.isArray(value) ? value.length : 0) => route.fulfill({
      status, contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range', 'content-range': total ? `0-${Math.min(10, total) - 1}/${total}` : '0-0/0' },
      body: JSON.stringify(value),
    })
    const fail = message => reply({ message, code: 'PGRST_TEST', details: '', hint: '' }, 400)
    if (method === 'OPTIONS') return route.fulfill({
      status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST, PATCH, DELETE' }, body: '',
    })
    if (path.endsWith('/auth/v1/user')) return reply(user)
    if (path.endsWith('/rpc/get_private_beta_access')) return reply({allowed:true})
    if (path.endsWith('/rpc/business_onboarding_status')) return reply({required:false,completed:true})
    if (path.endsWith('/functions/v1/document-pdf')) return fulfillPdf(route)
    if (path.endsWith('/rpc/get_invoice_payment_operations')) return reply({state:'clear',operations:[],refunds:[]})
    if (path.endsWith('/rpc/get_estimate_workflow_context')) return reply(body.p_estimates.flatMap(estimateId=>{
      const estimate=state.estimates.find(row=>row.id===estimateId)
      if(!estimate)return []
      const job=state.jobs.find(row=>row.id===estimate.job_id)||null
      return [{estimate_id:estimateId,job,appointment:state.appointments.find(row=>row.job_id===job?.id)||null,schedule:null,invitation:null,final_invoice_id:state.invoices.find(row=>row.estimate_id===estimateId&&!row.deposit_estimate_id)?.id||null}]
    }))
    if (path.endsWith('/rpc/get_membership_entry')) return reply(BID)
    if (path.endsWith('/rpc/get_worker_roster')) return reply({workers:[],active_count:0,worker_limit:5,plan:options.plan||'free'})
    if (path.endsWith('/rpc/get_schedule_team')) return reply(state.role==='viewer'?[]:[{id:UID,label:'QA Owner',role:state.role,is_you:true}])
    if (path.endsWith('/rpc/get_dashboard_attention_page')) {
      if(state.attentionFailure)return fail('Attention unavailable')
      const value=attentionPage(body,state),delay=state.attentionDelay;state.attentionDelay=0
      if(delay)await new Promise(resolve=>setTimeout(resolve,delay))
      return reply(value)
    }
    if (path.endsWith('/business_settings')) return reply({default_tax_rate:0,pricing_adjustment_percent:0,payment_links:[],payment_instructions:''})
    if (path.endsWith('/user_plan_preferences')) return reply({ user_id: UID, selected_tier: 'free' })
    if (path.endsWith('/user_agreement_acceptances')) return reply({ id: id(91), agreement_version: '2026-10-26-v2' })
    if (path.endsWith('/businesses') && method === 'PATCH') return reply({...business,...options.businessProfile,...body})
    if (path.endsWith('/business_members')) return reply({ role: state.role, access_modules: options.accessModules || ['calendar','jobs','billing','finances'], business_id: BID, businesses: {...business,...options.businessProfile} })
    if (path.endsWith('/rpc/get_plan_usage')) return reply({ plan: options.plan || 'free', ai_limit: 0, voice_limit: 0, logo_bytes_limit: 0 })
    if (path.endsWith('/rpc/get_invoice_job_context')) {
      const invoice=state.invoices.find(i=>i.id===body.p_invoice)
      return reply({preferences:{duration_minutes:120,buffer_minutes:30,notice_hours:24,work_days:[1,2,3,4,5],start_minutes:480,end_minutes:1020},team:[{id:UID,label:'Owner',role:'owner',is_you:true}],time_off:[],properties:[{id:id(77),label:'Service site',address:'1 Test Street'}],invoice:{id:invoice.id,number:invoice.invoice_number,customer_id:CID,customer_name:'Jane Doe',job_id:invoice.job_id||null,property_id:null,title:'Faucet repair',scope:'Faucet repair × 1'},schedule:null})
    }
    if (path.endsWith('/rpc/book_invoice_job')) {
      const invoice=state.invoices.find(i=>i.id===body.p_invoice)
      if(options.invoiceBookingError)return fail('The selected crew is already booked.')
      const previous=state.savedJobs.get(body.p_request)
      if(previous)return reply({...previous,already_created:true})
      const row={id:id(80),customer_id:CID,title:body.p_input.title,description:'Faucet repair × 1',status:'scheduled',scheduled_start:body.p_input.starts_at,scheduled_end:body.p_input.ends_at,assigned_user_ids:body.p_input.workers,customers:customer,properties:[]}
      state.jobs.push(row);invoice.job_id=row.id;state.appointments.push({id:id(81),job_id:row.id,title:row.title,starts_at:row.scheduled_start,ends_at:row.scheduled_end,status:'confirmed',customers:customer,jobs:row})
      const result={job_id:row.id,already_created:false};state.savedJobs.set(body.p_request,result);if(options.invoiceBookingLost)return reply({message:'Response lost after scheduling',code:'500'},504);return reply(result)
    }
    if (path.endsWith('/rpc/create_scheduled_job') || path.endsWith('/rpc/create_dispatched_job')) {
      if (state.jobError) return fail('Unable to create job')
      if (state.appointmentError) return fail('Unable to create appointment')
      const previous = state.savedJobs.get(body.request_id)
      if (previous) return reply(previous)
      const row = {
        id: id(80), appointment_id: id(81), business_id: body.target_business_id,
        customer_id: body.payload.customer_id, property_id: body.payload.property_id,
        title: body.payload.title, status: 'scheduled',
        scheduled_start: body.payload.scheduled_start, scheduled_end: body.payload.scheduled_end,
      }
      state.savedJobs.set(body.request_id, row)
      state.jobs.push({...row,customers:customer})
      state.appointments.push({
        id: row.appointment_id, job_id: row.id, business_id: row.business_id,
        customer_id: row.customer_id, title: row.title, status: 'scheduled',
        starts_at: row.scheduled_start, ends_at: row.scheduled_end,
        customers: customer, jobs: null,
      })
      return reply(row)
    }
    if (path.endsWith('/rpc/get_dashboard_invoice_totals')) {
      if (state.aggregateDelay) await new Promise(resolve => setTimeout(resolve, state.aggregateDelay))
      if (state.aggregateFailures-- > 0) return fail('Dashboard summary temporarily unavailable')
      return reply(state.aggregate)
    }
    if (path.endsWith('/rpc/search_job_customers')) return reply(customerSearchResponse(state.customers,body))
  if (path.endsWith('/customers')) return reply(req.headers().accept?.includes('vnd.pgrst.object')?state.customers.find(c=>c.id===url.searchParams.get('id')?.replace('eq.','')):state.customers)
    if (path.endsWith('/properties')) return reply([])
    if (path.endsWith('/rpc/get_document_change_context')) return reply({can_change:true})
    if (path.endsWith('/rpc/get_job_workflow_context')) {
      expect(body.p_business).toBe(BID)
      return reply(body.p_jobs.flatMap(jobId=>{
        const job=state.jobs.find(row=>row.id===jobId)
        if(!job)return []
        const current=state.appointments.find(row=>row.job_id===jobId&&['scheduled','confirmed','in_progress'].includes(row.status))
        const active_appointment=current||(['scheduled','in_progress'].includes(job.status)&&job.scheduled_start?{id:job.id,starts_at:job.scheduled_start,ends_at:job.scheduled_end||null,status:job.status==='in_progress'?'in_progress':'scheduled'}:null)
        return [{job_id:jobId,active_appointment,invoice:state.invoices.find(row=>row.job_id===jobId)||null}]
      }))
    }
    if (path.endsWith('/rpc/update_appointment_workflow')) {
      if(state.appointmentPatchError)return fail('Unable to update schedule')
      const row=state.appointments.find(appointment=>appointment.id===body.p_appointment)
      if(!row)return fail('Appointment no longer available')
      row.status=body.p_status
      return reply({appointment_id:row.id,status:row.status,job_id:row.job_id||null})
    }
    if (path.endsWith('/jobs')) {
      if(method==='PATCH'){
        const row=state.jobs.find(job=>job.id===url.searchParams.get('id')?.replace('eq.',''))
        if(!row)return reply(null)
        const previous=url.searchParams.get('description')
        if(previous&&(previous==='is.null'?row.description!=null:row.description!==previous.slice(3)))return reply(null)
        Object.assign(row,body)
        return reply({id:row.id})
      }
      if (req.headers().accept?.includes('vnd.pgrst.object')) return reply(state.jobs.find(job => job.id === url.searchParams.get('id')?.replace('eq.','')))
      if (method === 'POST') {
        if (state.jobError) return fail('Unable to create job')
        return reply({ id: id(80), ...body }, 201)
      }
      if (method === 'DELETE') return reply([])
      if (method === 'HEAD') return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-range': '0-0/0' }, body: '' })
      if (url.searchParams.has('status')) {
        const active = state.jobs.filter(job => ['lead','scheduled','in_progress'].includes(job.status))
        return reply(active.slice(0,Number(url.searchParams.get('limit') || active.length)), 200, active.length)
      }
      const matching=url.searchParams.has('customer_id')?state.jobs.filter(job=>job.customer_id===url.searchParams.get('customer_id').replace('eq.','')):state.jobs
      return reply(matching.slice(Number(url.searchParams.get('offset')||0),Number(url.searchParams.get('offset')||0)+Number(url.searchParams.get('limit')||matching.length)),200,matching.length)
    }
    if (path.endsWith('/appointments')) {
      if (method === 'POST') {
        if (state.appointmentError) return fail('Unable to create appointment')
        state.appointments.push({ id: id(81), ...body, customers: customer, jobs: null })
        return reply([], 201)
      }
      if (method === 'PATCH') {
        if (state.appointmentPatchError) return fail('Unable to update schedule')
        const target = url.searchParams.get('id')?.replace('eq.', '')
        const row = state.appointments.find(a => a.id === target)
        if (row) Object.assign(row, body)
        return reply([])
      }
      const rows=state.appointments.filter(a=>a.status!=='canceled'&&(!url.searchParams.has('id')||a.id===url.searchParams.get('id').replace('eq.',''))&&(!url.searchParams.has('job_id')||a.job_id===url.searchParams.get('job_id').replace('eq.','')))
      return reply(req.headers().accept?.includes('vnd.pgrst.object')?rows[0]||null:rows)
    }
    if (path.endsWith('/reminders')) {
      if (method === 'POST') {
        state.reminders.push({ ...body, jobs: state.jobs.find(job => job.id === body.job_id) || null })
        return reply({ id: body.id }, 201)
      }
      if (method === 'PATCH') {
        if (state.reminderError) return fail('Unable to complete reminder')
        const target = url.searchParams.get('id')?.replace('eq.', '')
        const row = state.reminders.find(r => r.id === target)
        if (row) Object.assign(row, body)
        return reply({ id: row?.id })
      }
      const status = url.searchParams.get('status')?.replace('eq.', '')
      const due = url.searchParams.get('due_at')
      const matching = state.reminders.filter(r => r.status === status && (!due || (due.startsWith('lt.') ? Date.parse(r.due_at) < Date.parse(due.slice(3)) : Date.parse(r.due_at) <= Date.parse(due.slice(4)))))
      const offset = Number(url.searchParams.get('offset') || 0)
      const limit = Number(url.searchParams.get('limit') || 50)
      return reply(matching.slice(offset, offset + limit), 200, matching.length)
    }
    if (path.endsWith('/rpc/get_business_storage_usage')) return reply({ plan: options.plan || 'pro', limit_bytes: 10000000000, remaining_bytes: 10000000000, used_bytes: 0, pending_bytes: 0, warning: 'none', logo_allowed: true, ...options.storageUsage })
    if (path.endsWith('/functions/v1/receipt-scan')) return options.scanUnavailable
      ? reply({error:'Automatic receipt reading is awaiting setup. You can enter the details and save the photo.'},503)
      : reply({vendor:'Supply Store',date:receiptDay(),total:'48.91',tax:'2.91',items:['Treated wood'],warning:''})
    if (path.endsWith('/rpc/save_receipt_expense')) {
      const entry = body.p_entry, path = `${BID}/${entry.id}.jpg`
      if (!state.expenses.some(item => item.id === entry.id)) state.expenses.push({...entry,record_photos:{storage_path:path}})
      return reply(path)
    }
    if (path.endsWith('/functions/v1/upload-attachment')) {
      const attachment = url.searchParams.get('path')
      if (state.expenses.some(row => row.record_photos?.storage_path === attachment)) {
        if (state.receiptUploadFailures > 0) {
          state.receiptUploadFailures--
          return reply({error:'Upload was not confirmed.'},502)
        }
        state.uploadedReceipts.add(attachment)
      }
      state.storageWrites++
      return reply({ path: attachment })
    }
    if (path.endsWith('/record_photos')) {
      if (method === 'GET' && state.photoLoadFailures > 0) { state.photoLoadFailures--; return fail('Photos temporarily unavailable.') }
      if (method === 'POST') { state.photos.push({ ...body, created_by: UID, storage_path: `${BID}/${body.id}.jpg`, created_at: new Date().toISOString() }); return reply(null, 201) }
      if (method === 'DELETE') { const target = url.searchParams.get('id')?.replace('eq.', ''); const deleted = state.photos.filter(p => p.id === target); state.photos = state.photos.filter(p => p.id !== target); return reply(deleted) }
      const column = ['job_id', 'estimate_id', 'invoice_id'].find(key => url.searchParams.has(key))
      const matching = column ? state.photos.filter(p => p[column] === url.searchParams.get(column).replace('eq.', '')) : state.photos
      return reply(matching, 200, matching.length)
    }
    if (path.includes('/storage/v1/object/sign/') && method === 'POST') {
      if (body.paths) return reply(body.paths.map(path => ({ path, signedURL: `/object/sign/finviant-record-photos/${path}?token=test`, error: null })))
      const file = path.split('/sign/finviant-record-photos/')[1]
      return state.uploadedReceipts.has(file)
        ? reply({signedURL:`/object/sign/finviant-record-photos/${file}?token=test`})
        : reply({message:'Object missing'},404)
    }
    if (path.includes('/storage/v1/object/sign/') && method === 'GET') return route.fulfill({contentType:'image/png', body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAFElEQVR4nGNkaGhgwAaYsIoOWgkAzIgBEFCQDcoAAAAASUVORK5CYII=', 'base64')})
    if (path.includes('/storage/v1/object/finviant-record-photos')) {
      if (method === 'POST') { state.storageWrites++; return reply({ Key: path.split('/object/')[1], Id: id(999) }, 200) }
      return reply([])
    }
    if (path.endsWith('/bookkeeping_entries')) {
      if (method === 'POST') { state.expenses.push(body); return reply(null, 201) }
      if (method === 'DELETE') { state.expenses = state.expenses.filter(p => p.id !== url.searchParams.get('id')?.replace('eq.', '')); return reply([]) }
      const column = ['job_id', 'estimate_id', 'invoice_id'].find(key => url.searchParams.has(key))
      const matching = column ? state.expenses.filter(p => p[column] === url.searchParams.get(column).replace('eq.', '')) : state.expenses
      return reply(matching, 200, matching.length)
    }
    if ((path.endsWith('/invoices') || path.endsWith('/estimates')) && url.searchParams.get('limit') === '5') {
      const rows = path.endsWith('/invoices') ? state.invoices : state.estimates
      return reply([...rows].map(row => ({ ...row, total: row.total ?? row.balance_due ?? 0, created_at: row.created_at || `${row.issue_date || '2026-11-01'}T12:00:00Z` }))
        .sort((a,b) => b.created_at.localeCompare(a.created_at)).slice(0,5))
    }
    if (path.endsWith('/invoices')) {
      if (req.headers().accept?.includes('vnd.pgrst.object')) return reply(state.invoices.find(i => i.id === url.searchParams.get('id')?.replace('eq.', '')))
      const matches = url.searchParams.has('customer_id') ? state.invoices.filter(i=>i.customer_id===url.searchParams.get('customer_id').replace('eq.','')) : url.searchParams.has('due_date') ? state.invoices.filter(i => i.due_date < url.searchParams.get('due_date').replace('lt.', '') && Number(i.balance_due) > 0 && ['sent','viewed','partial','overdue'].includes(i.status)) : state.invoices
      return reply(matches.slice(Number(url.searchParams.get('offset') || 0), Number(url.searchParams.get('offset') || 0) + Number(url.searchParams.get('limit') || 10)), 200, matches.length)
    }
    if (path.endsWith('/estimates')) {
      if(req.headers().accept?.includes('vnd.pgrst.object'))return reply(state.estimates.find(row=>row.id===url.searchParams.get('id')?.replace('eq.','')))
      const matches = url.searchParams.has('customer_id') ? state.estimates.filter(e=>e.customer_id===url.searchParams.get('customer_id').replace('eq.','')) : url.searchParams.has('status') ? state.estimates.filter(e => e.status === url.searchParams.get('status').replace('eq.', '')) : state.estimates
      return reply(matches.slice(Number(url.searchParams.get('offset') || 0), Number(url.searchParams.get('offset') || 0) + Number(url.searchParams.get('limit') || 10)), 200, matches.length)
    }
    if (path.endsWith('/change_orders')) return reply(state.changeOrders.slice(0, 10), 200, state.changeOrders.length)
    if (path.endsWith('/messages')) return reply([])
    return reply([])
  })
 await mockJobDirectory(page,()=>state.jobs.map(job=>{
  const current=state.appointments.find(row=>row.job_id===job.id&&['scheduled','confirmed','in_progress'].includes(row.status))
  return {...job,active_appointment:current||(['scheduled','in_progress'].includes(job.status)&&job.scheduled_start?{id:job.id,starts_at:job.scheduled_start,ends_at:job.scheduled_end||null,status:job.status==='in_progress'?'in_progress':'scheduled'}:null),invoice:state.invoices.find(row=>row.job_id===job.id)||null}
 }),options.businessProfile?.timezone||'America/New_York')
  return state
}

// Management scenarios model conditional writes and complete calendar-range reads.
async function managedReminders(page, options = {}) {
  const zone='America/New_York'
  // Keep the reminder due today even when the suite runs before business hours.
  const row={...reminder(9901),business_id:BID,due_at:DateTime.now().setZone(zone).startOf('day').toUTC().toISO(),note:'Check supply order',...options.row}
  const state=await mockWorkspace(page,{...options,reminders:[row],businessProfile:{timezone:zone}})
  state.patchFailure=false;state.lostResponse=false;state.patchDelay=0
  await page.route('**/rest/v1/reminders?**',async route=>{
    const req=route.request(),url=new URL(req.url()),target=url.searchParams.get('id')?.replace('eq.','')
    const reply=(body,status=200)=>route.fulfill({status,contentType:'application/json',headers:{'access-control-expose-headers':'content-range','content-range':Array.isArray(body)?`*/${body.length}`:'*/1'},body:JSON.stringify(body)})
    if(req.method()==='GET'&&target)return reply(state.reminders.find(r=>r.id===target)||null)
    if(req.method()==='GET'&&url.searchParams.get('status')?.startsWith('in.')){
      const from=url.searchParams.getAll('due_at').find(s=>s.startsWith('gte.'))?.slice(4),to=url.searchParams.getAll('due_at').find(s=>s.startsWith('lt.'))?.slice(3)
      return reply(state.reminders.filter(r=>r.status!=='canceled'&&(!from||Date.parse(r.due_at)>=Date.parse(from))&&(!to||Date.parse(r.due_at)<Date.parse(to))))
    }
    if(req.method()==='PATCH'){
      const body=req.postDataJSON();state.requests.push({path:url.pathname,method:'PATCH',url:url.toString(),body})
      if(state.patchDelay)await new Promise(r=>setTimeout(r,state.patchDelay))
      if(state.patchFailure)return reply({message:'Reminder update failed',code:'PGRST_TEST'},400)
      const row=state.reminders.find(r=>r.id===target)
      const matches=row&&url.searchParams.get('business_id')==='eq.'+BID&&['status','due_at','note'].every(k=>{
        const expected=url.searchParams.get(k);return !expected||(expected==='is.null'?row[k]===null:k==='due_at'?Date.parse(row[k])===Date.parse(expected.slice(3)):row[k]===expected.slice(3))
      })
      if(!matches)return reply([])
      Object.assign(row,body)
      if(state.lostResponse)return reply({message:'Response lost',code:'504'},504)
      return reply({id:row.id})
    }
    return route.fallback()
  })
  await page.goto('/?view=dashboard')
  return {state,row,zone,calendar:page.getByRole('region',{name:'Work calendar'}),dialog:page.getByRole('dialog',{name:'Manage reminder',exact:true})}
}

for(const width of [1440,390])test(`calendar reminder management edits and reschedules one shared record at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:950})
  const {state,row,zone,calendar,dialog}=await managedReminders(page)
  await calendar.getByRole('button',{name:'Open reminder Check supply order',exact:true}).click()
  await expect(dialog.getByRole('textbox',{name:'What needs to be done?',exact:true})).toHaveValue('Check supply order')
  await dialog.getByRole('textbox',{name:'What needs to be done?',exact:true}).fill('Collect materials at the supplier')
  const date=DateTime.now().setZone(zone).plus({days:1}).set({hour:10,minute:15,second:0,millisecond:0})
  await dialog.getByLabel('Remind me on',{exact:true}).fill(date.toFormat("yyyy-MM-dd'T'HH:mm"))
  await page.screenshot({path:`test-results/reminder-editor-${width}.png`,fullPage:true})
  await dialog.getByRole('button',{name:'Save changes',exact:true}).click()
  await expect(dialog).toHaveCount(0)
  await expect(attentionCount(page)).toHaveText('0')
  expect(state.reminders).toHaveLength(1);expect(row.due_at).toBe(date.toUTC().toISO());expect(row.note).toBe('Collect materials at the supplier')
  await expect(calendar.getByRole('button',{name:/Open reminder Collect materials/})).toHaveCount(0)
  await calendar.getByRole('button',{name:new RegExp('^'+date.toLocaleString(DateTime.DATE_FULL)+',')}).click()
  await expect(calendar.getByRole('button',{name:/Open reminder Collect materials/})).toBeVisible()
  await page.goto('/?view=reminders')
  await page.getByRole('button',{name:/Open reminder Collect materials/}).click()
  await expect(dialog.getByLabel('Remind me on',{exact:true})).toHaveValue(date.toFormat("yyyy-MM-dd'T'HH:mm"))
  expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true)
})

test('calendar reminder management completes, reopens and confirms deletion across calendar and attention',async({page})=>{
  const {state,row,calendar,dialog}=await managedReminders(page)
  await expect(attentionCount(page)).toHaveText('1')
  await calendar.getByRole('button',{name:/Open reminder Check supply order/}).click()
  await dialog.getByRole('button',{name:'Mark complete',exact:true}).click()
  await expect(dialog).toHaveCount(0);await expect(attentionCount(page)).toHaveText('0')
  await expect(calendar.locator('.calendar-reminders li.completed')).toContainText('Check supply order')
  await calendar.getByRole('button',{name:/Open reminder Check supply order/}).click()
  await expect(dialog.getByLabel('Remind me on',{exact:true})).toBeDisabled()
  await dialog.getByRole('button',{name:'Reopen reminder',exact:true}).click()
  await expect(attentionCount(page)).toHaveText('1');expect(row.completed_at).toBeNull()
  await page.getByRole('region',{name:'Needs Attention',exact:true}).getByRole('button',{name:/Open reminder Check supply order/}).click()
  await dialog.getByRole('button',{name:'Delete reminder',exact:true}).click()
  expect(count(state,'/reminders','PATCH')).toBe(2)
  await dialog.getByRole('button',{name:'Keep reminder',exact:true}).click()
  await dialog.getByRole('button',{name:'Delete reminder',exact:true}).click()
  await dialog.getByRole('group',{name:'Confirm reminder deletion'}).getByRole('button',{name:'Delete reminder',exact:true}).click()
  await expect(dialog).toHaveCount(0);await expect(attentionCount(page)).toHaveText('0')
  await expect(calendar.getByRole('button',{name:/Open reminder Check supply order/})).toHaveCount(0)
  expect(row.status).toBe('canceled');expect(count(state,'/reminders','DELETE')).toBe(0)
})

test('calendar reminder management keeps failed edits and rejects a stale concurrent save',async({page})=>{
  const {state,row,calendar,dialog}=await managedReminders(page)
  await calendar.getByRole('button',{name:/Open reminder Check supply order/}).click()
  await dialog.getByRole('textbox',{name:'What needs to be done?',exact:true}).fill('My retained changes')
  state.patchFailure=true
  await dialog.getByRole('button',{name:'Save changes',exact:true}).click()
  await expect(dialog.getByRole('alert')).toContainText('Reminder update failed')
  await expect(dialog.getByRole('textbox',{name:'What needs to be done?',exact:true})).toHaveValue('My retained changes')
  state.patchFailure=false;row.note='Office changed this reminder'
  await dialog.getByRole('button',{name:'Save changes',exact:true}).click()
  await expect(dialog.getByRole('alert')).toContainText('changed elsewhere')
  expect(row.note).toBe('Office changed this reminder')
  await dialog.getByRole('button',{name:'Reload reminder',exact:true}).click()
  await expect(dialog.getByRole('textbox',{name:'What needs to be done?',exact:true})).toHaveValue('Office changed this reminder')
  await dialog.getByRole('textbox',{name:'What needs to be done?',exact:true}).fill('Reviewed final wording')
  state.lostResponse=true;state.patchDelay=150
  await dialog.getByRole('button',{name:'Save changes',exact:true}).dblclick()
  await expect(dialog).toHaveCount(0);expect(row.note).toBe('Reviewed final wording')
  expect(count(state,'/reminders','PATCH')).toBe(3)
})

test('calendar reminder management viewers have read-only access and cannot mutate reminders',async({page})=>{
  const {state,calendar,dialog}=await managedReminders(page,{role:'viewer'})
  await calendar.getByRole('button',{name:/Open reminder Check supply order/}).click()
  await expect(dialog.getByRole('textbox',{name:'What needs to be done?',exact:true})).toBeDisabled()
  await expect(dialog.getByLabel('Remind me on',{exact:true})).toBeDisabled()
  await expect(dialog.getByRole('button',{name:/Save changes|Delete reminder|Mark complete|Reopen reminder/})).toHaveCount(0)
  expect(count(state,'/reminders','PATCH')).toBe(0)
})

test('calendar reminder management rejects DST gaps and duplicate-hour times without a write',async({page})=>{
  const {state,calendar,dialog}=await managedReminders(page)
  await calendar.getByRole('button',{name:/Open reminder Check supply order/}).click()
  for(const due of ['2027-03-14T02:30','2027-11-07T01:30']){
    await dialog.getByLabel('Remind me on',{exact:true}).fill(due)
    await dialog.getByRole('button',{name:'Save changes',exact:true}).click()
    await expect(dialog.getByRole('alert')).toContainText('unambiguous valid date and time')
  }
  expect(count(state,'/reminders','PATCH')).toBe(0)
})
const attentionCount = page => page.getByRole('group',{name:'Home work queue'}).getByRole('button',{name:/^Needs Attention /}).locator('span')
const count = (s, suffix, method) => s.requests.filter(r => r.path.endsWith(suffix) && (!method || r.method === method)).length
const openDashboard = async (page, options) => {
  const state = await mockWorkspace(page, options)
  await page.goto('/?view=dashboard')
  await expect(page.getByRole('heading', { level: 1, name: options?.businessProfile?.name || 'Velnu QA', exact: true })).toBeVisible()
  return state
}
const openSchedule = async (page, options) => {
  const state = await mockWorkspace(page, options)
  await page.goto('/?view=schedule')
  await expect(page.getByRole('heading', { name: 'Know where you need to be next.' })).toBeVisible()
  return state
}
const showForm = async page => {
  await page.getByRole('button', { name: 'Book or reschedule job', exact: true }).click()
  await page.getByRole('link', { name: 'Create scheduled job', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Add a job to the calendar' })).toBeVisible()
}
const completeForm = async (page, start = localDatetime(), end = localDatetime(1, 11)) => {
  await showForm(page)
  await page.getByRole('dialog').getByRole('combobox',{name:'Customer',exact:true}).fill('Jane')
  await page.getByRole('option',{name:/Jane Doe/}).click()
  await page.getByLabel('Job title', { exact: true }).fill('Replace faucet')
  await page.getByLabel('Starts').fill(start)
  if (end) await page.getByLabel('Ends').fill(end)
}
const noRuntimeErrors = page => {
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  return errors
}

// DASHBOARD: 12 critical cases

test('01 empty dashboard renders without uncaught exceptions', async ({ page }) => {
  const errors = noRuntimeErrors(page)
  await openDashboard(page)
  await expect(page.getByText('No items need attention.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled()
  expect(errors).toEqual([])
})

test('02 Strict Mode concurrent initial loads share one invoice summary call', async ({ page }) => {
  const state = await openDashboard(page, { aggregate: { open_invoices: 1, outstanding_balance: 30 } })
  await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled()
  expect(count(state, '/rpc/get_dashboard_invoice_totals', 'POST')).toBe(1)
})

test('03 null aggregate values display zero safely', async ({ page }) => {
  await openDashboard(page, { aggregate: { open_invoices: null, outstanding_balance: null } })
  await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled()
  await expect(page.locator('.home-overview')).not.toContainText('NaN')
})

test('04 large financial summary stays server-side without an unbounded invoice scan', async ({ page }) => {
  const state = await openDashboard(page, { aggregate: { open_invoices: 12001, outstanding_balance: '123456789.22' } })
  await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled()
  expect(count(state, '/rpc/get_dashboard_invoice_totals', 'POST')).toBe(1)
  expect(state.requests.filter(r => r.path.endsWith('/invoices') && new URL(r.url).searchParams.get('select') === 'balance_due')).toHaveLength(0)
})

test('05 failed invoice-summary RPC displays recoverable error instead of crashing', async ({ page }) => {
  const state = await openDashboard(page, { aggregateFailures: 20 })
  await expect(page.getByText('Dashboard summary temporarily unavailable')).toBeVisible().catch(async err => {
    console.log('Dashboard error diagnostic', JSON.stringify({
      requests: state?.requests?.filter?.(r => r.path.includes('dashboard_invoice_totals')),
      alerts: await page.locator('.form-message').allTextContents(),
      text: (await page.locator('.page-stack').first().innerText()).slice(0, 700),
    }))
    throw err
  })
  await expect(page.getByRole('button', { name: 'Refresh' })).toBeEnabled()
})

test('06 dashboard manual refresh recovers after failed RPC', async ({ page }) => {
  const state = await openDashboard(page, { aggregateFailures: 20, aggregate: { open_invoices: 2, outstanding_balance: 42 } })
  await expect(page.getByText('Dashboard summary temporarily unavailable')).toBeVisible()
  state.aggregateFailures = 0
  await page.getByRole('button', { name: 'Refresh' }).click()
  await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled()
  await expect(page.getByText('Dashboard summary temporarily unavailable')).toHaveCount(0)
  expect(count(state, '/rpc/get_dashboard_invoice_totals', 'POST')).toBeGreaterThanOrEqual(2)
})

test('07 navigation during a slow dashboard load does not resurrect the old screen', async ({ page }) => {
  const errors = noRuntimeErrors(page)
  await mockWorkspace(page, { aggregateDelay: 850 })
  await page.goto('/?view=dashboard')
  await expect(page.getByRole('heading', { level: 1, name: 'Velnu QA', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'More', exact: true }).click()
  await page.getByRole('dialog', { name: 'More navigation' }).getByRole('link', { name: /^Schedule/ }).click()
  await expect(page.getByRole('heading', { name: 'Know where you need to be next.' })).toBeVisible()
  await page.waitForTimeout(950)
  await expect(page.getByRole('heading', { name: 'Know where you need to be next.' })).toBeVisible()
  expect(errors).toEqual([])
})

test('08 absent customer relations and injected invoice HTML do not crash or render executable markup', async ({ page }) => {
  const malicious = '<img src=x onerror=alert(1)>'
  await openDashboard(page, { invoices: [{ id: id(9), invoice_number: malicious, status: 'sent', balance_due: 15, due_date: '2020-01-01', customers: null }] })
  await expect(page.getByRole('region', { name: 'Needs Attention', exact: true })).toContainText('Customer')
  await expect(page.getByRole('region', { name: 'Needs Attention', exact: true })).toContainText(malicious)
  expect(await page.getByRole('region', { name: 'Needs Attention', exact: true }).locator('img').count()).toBe(0)
})

for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
  test(`billing hub counts all overdue invoices and keeps details together at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport)
    const invoices = Array.from({ length: 14 }, (_, n) => ({
      id: id(n + 300), invoice_number: `INV-${n + 1}`, balance_due: 15,
      due_date: '2020-01-01', issue_date: '2019-12-01', status: 'sent', total: 15, customers: customer,
    }))
    const state = await openDashboard(page, { invoices })
    const tile = page.getByRole('article', { name: 'Needs attention overview' })
    await tile.getByRole('group',{name:'Home work queue'}).getByRole('button', { name: /^Needs Attention 14$/ }).click()
    await expect(tile.getByRole('region', { name: 'Needs Attention', exact: true }).getByRole('listitem')).toHaveCount(5)
    await expect(tile).toContainText('Jane Doe')
    await expect(tile).toContainText('INV-1')
    await expect(tile).toContainText('$15.00')
    await expect(tile).toContainText('Showing 1–5 of 14')
    await expect(page.locator('.overdue-panel')).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

    state.invoices = []
    await page.getByRole('button', { name: 'Refresh', exact: true }).click()
    await expect(tile.getByText('No items need attention.')).toBeVisible()
    await expect(tile.locator('.invoice-overdue-badge')).toHaveCount(0)
    await page.getByRole('navigation').getByRole('button', { name:'Invoices',exact:true }).click()
    await expect(page.getByRole('heading', { name: 'Invoices', exact:true })).toBeVisible()
  })
}

test('09 completing reminder persists its status and removes it from attention list', async ({ page }) => {
  const state = await openDashboard(page, { reminders: [reminder()] })
  await page.goto('/?view=reminders')
  await expect(page.getByText('Call customer 1')).toBeVisible()
  await page.getByRole('button', { name: /Mark .* done/ }).click()
  await expect(page.getByText('Call customer 1')).toHaveCount(0)
  expect(count(state, '/reminders', 'PATCH')).toBe(1)
  expect(state.reminders[0].status).toBe('completed')
})

test('dashboard attention updates immediately when a calendar reminder is completed', async ({ page }) => {
  const state = await openDashboard(page, { reminders: [reminder()] })
  await expect(attentionCount(page)).toHaveText('1')
  const calendar = page.getByRole('region', { name: 'Work calendar' })
  await page.getByRole('region', { name: 'Needs Attention', exact: true }).getByRole('button', { name: 'Complete Call customer 1', exact: true }).click()
  await expect(calendar.getByText('Call customer 1', { exact: true })).toHaveCount(0)
  await expect(attentionCount(page)).toHaveText('0')
  expect(count(state, '/reminders', 'PATCH')).toBe(1)
})

test('a failed calendar reminder update keeps the attention count and retry action', async ({ page }) => {
  await openDashboard(page, { reminders: [reminder()], reminderError: true })
  await expect(attentionCount(page)).toHaveText('1')
  const calendar = page.getByRole('region', { name: 'Work calendar' })
  await page.getByRole('region', { name: 'Needs Attention', exact: true }).getByRole('button', { name: 'Complete Call customer 1', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Needs Attention', exact: true }).getByRole('alert')).toContainText('Unable to complete this reminder')
  await expect(page.getByRole('region', { name: 'Needs Attention', exact: true }).getByText('Call customer 1', { exact: true })).toBeVisible()
  await expect(attentionCount(page)).toHaveText('1')
})

test('returning to the dashboard refreshes attention after another worker resolves a reminder', async ({ page }) => {
  const state = await openDashboard(page, { reminders: [reminder()] })
  await expect(attentionCount(page)).toHaveText('1')
  state.reminders[0].status = 'completed'
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await expect(attentionCount(page)).toHaveText('0')
  await expect(page.getByRole('region', { name: 'Work calendar' }).getByText('Call customer 1', { exact: true })).toHaveCount(0)
})

test('the visible dashboard refreshes attention in the background without a reload', async ({ page }) => {
  await page.clock.install()
  const state = await openDashboard(page, { reminders: [reminder()] })
  await expect(attentionCount(page)).toHaveText('1')
  state.reminders[0].status = 'completed'
  await page.clock.fastForward('00:31')
  await expect(attentionCount(page)).toHaveText('0')
})

test('10 failing reminder update displays error and does not hide the reminder', async ({ page }) => {
  await openDashboard(page, { reminders: [reminder()], reminderError: true })
  await page.goto('/?view=reminders')
  await page.getByRole('button', { name: /Mark .* done/ }).click()
  await expect(page.getByText('Unable to complete reminder')).toBeVisible()
  await expect(page.getByText('Call customer 1')).toBeVisible()
})

test('11 viewer cannot complete reminders', async ({ page }) => {
  const state = await openDashboard(page, { role: 'viewer', reminders: [reminder()] })
  await page.goto('/?view=reminders')
  await expect(page.getByText('Call customer 1')).toBeVisible()
  await expect(page.getByRole('button', { name: /Mark .* done/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '+ New reminder' })).toHaveCount(0)
  expect(count(state, '/reminders', 'PATCH')).toBe(0)
})

test('12 dashboard tenant filters and bounded approval lists are preserved', async ({ page }) => {
  const estimates = Array.from({ length: 10 }, (_, n) => ({
    id: id(n + 100), estimate_number: 'EST-' + n, status: 'sent', total: 25,
    issue_date: '2026-10-01', customers: customer,
  }))
  const changeOrders = Array.from({ length: 10 }, (_, n) => ({
    id: id(n + 200), change_order_number: 'CO-' + n, title: 'Change ' + n,
    status: 'sent', total: 50, issue_date: '2026-10-02', customers: customer,
  }))
  const state = await openDashboard(page, { estimates, changeOrders })
  const tile = page.getByRole('article', { name: 'Needs attention overview' })
  await tile.getByRole('group',{name:'Home work queue'}).getByRole('button', { name: /^Awaiting Customer Approval 20/ }).click()
  await expect(tile.getByRole('region', { name: 'Awaiting Customer Approval' }).getByRole('listitem')).toHaveCount(5)
  await expect(tile).toContainText('EST-0')
  await expect(tile).toContainText('Jane Doe')
  await expect(tile).toContainText('Showing 1–5 of 20')
  await expect(page.getByRole('heading', { name: 'Approvals', exact: true })).toHaveCount(0)
  for (const request of state.requests.filter(r =>
    ['/invoices', '/jobs', '/reminders', '/appointments', '/estimates', '/change_orders'].some(p => r.path.endsWith(p)))) {
    expect(new URL(request.url).searchParams.get('business_id'), request.url).toBe('eq.' + BID)
  }
  expect(state.requests.filter(r => ['/estimates', '/change_orders', '/reminders'].some(p => r.path.endsWith(p)) && new URL(r.url).searchParams.get('limit') === null)).toEqual([])
  state.estimates = []
  state.changeOrders = []
  await page.getByRole('button', { name: 'Refresh', exact: true }).click()
  await expect(tile).toContainText('No estimates or change orders are waiting for approval.')
  await expect(tile.locator('.estimate-approval-badge')).toHaveCount(0)
  await page.getByRole('navigation').getByRole('button', { name:'Estimates',exact:true }).click()
  await expect(page.getByRole('heading', { name: 'Estimates', exact:true })).toBeVisible()
})

// SCHEDULE: 13 critical cases

test('13 empty schedule shows its empty state', async ({ page }) => {
  await openSchedule(page)
  await expect(page.getByText('Nothing scheduled')).toBeVisible()
})

test('14 viewers cannot schedule work or update an existing appointment', async ({ page }) => {
  const state = await openSchedule(page, { role: 'viewer', appointments: [appointment()] })
  await expect(page.getByRole('button', { name: 'Book or reschedule job' })).toHaveCount(0)
  await expect(page.locator('.appointment-row select')).toBeDisabled()
  expect(count(state, '/appointments', 'PATCH')).toBe(0)
})

test('15 missing customer blocks job creation', async ({ page }) => {
  const state = await openSchedule(page)
  await showForm(page)
  await page.getByLabel('Job title', { exact: true }).fill('No customer')
  await page.getByLabel('Starts').fill(localDatetime())
  await page.getByRole('button', { name: 'Schedule job' }).click()
  await expect(page.getByRole('dialog').getByRole('combobox',{name:'Customer',exact:true})).toBeVisible()
  expect(count(state, '/jobs', 'POST')).toBe(0)
  expect(count(state, '/rpc/create_scheduled_job', 'POST')+count(state, '/rpc/create_dispatched_job', 'POST')).toBe(0)
})

test('16 blank title blocks job creation', async ({ page }) => {
  const state = await openSchedule(page)
  await showForm(page)
  await page.getByRole('dialog').getByRole('combobox',{name:'Customer',exact:true}).fill('Jane')
  await page.getByRole('option',{name:/Jane Doe/}).click()
  await page.getByLabel('Starts').fill(localDatetime())
  await page.getByRole('button', { name: 'Schedule job' }).click()
  expect(count(state, '/jobs', 'POST')).toBe(0)
  expect(count(state, '/rpc/create_scheduled_job', 'POST')+count(state, '/rpc/create_dispatched_job', 'POST')).toBe(0)
  await expect(page.getByLabel('Job title', { exact: true })).toBeVisible()
})

test('17 missing start time blocks job creation', async ({ page }) => {
  const state = await openSchedule(page)
  await showForm(page)
  await page.getByRole('dialog').getByRole('combobox',{name:'Customer',exact:true}).fill('Jane')
  await page.getByRole('option',{name:/Jane Doe/}).click()
  await page.getByLabel('Job title', { exact: true }).fill('No time')
  await page.getByRole('button', { name: 'Schedule job' }).click()
  expect(count(state, '/jobs', 'POST')).toBe(0)
  expect(count(state, '/rpc/create_scheduled_job', 'POST')+count(state, '/rpc/create_dispatched_job', 'POST')).toBe(0)
})

test('18 end time before start is rejected without a database write', async ({ page }) => {
  const state = await openSchedule(page)
  await completeForm(page, localDatetime(1, 11), localDatetime(1, 10))
  await page.getByRole('button', { name: 'Schedule job' }).click()
  await expect(page.getByText('End time must be after the start time')).toBeVisible()
  expect(count(state, '/jobs', 'POST')).toBe(0)
  expect(count(state, '/rpc/create_scheduled_job', 'POST')+count(state, '/rpc/create_dispatched_job', 'POST')).toBe(0)
})

test('19 zero-minute appointment is rejected at the equality boundary', async ({ page }) => {
  const state = await openSchedule(page)
  await completeForm(page, localDatetime(1, 11), localDatetime(1, 11))
  await page.getByRole('button', { name: 'Schedule job' }).click()
  await expect(page.getByText('End time must be after the start time')).toBeVisible()
  expect(count(state, '/jobs', 'POST')).toBe(0)
  expect(count(state, '/rpc/create_scheduled_job', 'POST')+count(state, '/rpc/create_dispatched_job', 'POST')).toBe(0)
})

test('20 valid schedule submits local date values as UTC and does not duplicate job creation', async ({ page }) => {
  const state = await openSchedule(page)
  const start = localDatetime(1, 10)
  const end = localDatetime(1, 11)
  await completeForm(page, start, end)
  // Force both DOM events before React can paint the disabled state.
  await page.getByRole('button', { name: 'Schedule job' }).evaluate(button => {
    button.click()
    button.click()
  })
  await expect(page.getByRole('heading', { name: 'Add a job to the calendar' })).toHaveCount(0)
  expect(count(state, '/rpc/create_scheduled_job', 'POST')).toBe(1)
  const request = state.requests.find(r => r.path.endsWith('/rpc/create_scheduled_job'))
  expect(request.body.payload.scheduled_start).toBe(new Date(start).toISOString())
  expect(request.body.payload.scheduled_end).toBe(new Date(end).toISOString())
  expect(state.savedJobs.size).toBe(1)
  expect(state.appointments).toHaveLength(1)
  expect(count(state, '/appointments', 'POST')).toBe(0)
})

test('21 optional end date produces a null scheduled end', async ({ page }) => {
  const state = await openSchedule(page)
  await completeForm(page, localDatetime(), null)
  await page.getByRole('button', { name: 'Schedule job' }).click()
  await expect(page.getByRole('heading', { name: 'Add a job to the calendar' })).toHaveCount(0)
  expect(state.requests.find(r => r.path.endsWith('/rpc/create_scheduled_job')).body.payload.scheduled_end).toBeNull()
})

test('22 failed job insert preserves the form and displays a recoverable error', async ({ page }) => {
  const state = await openSchedule(page, { jobError: true })
  await completeForm(page)
  await page.getByRole('button', { name: 'Schedule job' }).click()
  await expect(page.getByText('Unable to create job')).toBeVisible()
  await expect(page.getByLabel('Job title', { exact: true })).toHaveValue('Replace faucet')
  expect(count(state, '/rpc/create_scheduled_job', 'POST')).toBe(1)
  expect(state.savedJobs.size).toBe(0)
  expect(state.appointments).toHaveLength(0)
})

test('23 failed appointment insert rolls back the whole scheduled-job transaction', async ({ page }) => {
  const state = await openSchedule(page, { appointmentError: true })
  await completeForm(page)
  await page.getByRole('button', { name: 'Schedule job' }).click()
  await expect(page.getByText('Unable to create appointment')).toBeVisible()
  expect(count(state, '/rpc/create_scheduled_job', 'POST')).toBe(1)
  expect(state.savedJobs.size).toBe(0)
  expect(state.appointments).toHaveLength(0)
  expect(count(state, '/jobs', 'DELETE')).toBe(0)
})

test('24 successful status change updates the appointment exactly once', async ({ page }) => {
  const state = await openSchedule(page, { appointments: [appointment()] })
  await page.locator('.appointment-row select').selectOption('confirmed')
  await expect.poll(() => state.appointments[0].status).toBe('confirmed')
  expect(count(state, '/rpc/update_appointment_workflow', 'POST')).toBe(1)
  expect(count(state, '/appointments', 'PATCH')).toBe(0)
})

test('25 failed status change reports an error and leaves stored status unchanged', async ({ page }) => {
  const state = await openSchedule(page, { appointments: [appointment()], appointmentPatchError: true })
  await page.locator('.appointment-row select').selectOption('completed')
  await expect(page.getByText('Unable to update schedule')).toBeVisible()
  expect(state.appointments[0].status).toBe('scheduled')
})

test('jobs workspace separates current, upcoming, and historical jobs', async ({ page }) => {
  const jobs = [
    { id: id(501), title: 'Current repair', status: 'in_progress', scheduled_start: localDatetime(-1) },
    { id: id(502), title: 'Future repair', status: 'scheduled', scheduled_start: localDatetime(2) },
    { id: id(503), title: 'Completed repair', status: 'completed', scheduled_start: localDatetime(-2) },
  ].map(job => ({ ...job, customer_id: CID, customers: customer }))
  await openSchedule(page, { jobs, appointments: [appointment()] })
  await expect(page.locator('.appointment-row')).toContainText('Visit 1')
  await page.goto('/?view=work')
  await expect(page.getByRole('region', { name: 'active jobs' })).toContainText('Current repair')
  await expect(page.getByRole('region', { name: 'active jobs' })).toContainText('Future repair')
  await expect(page.getByRole('region', { name: 'active jobs' })).not.toContainText('Completed repair')
  await page.getByRole('button', { name: 'Open filters' }).click()
  await page.getByRole('button', { name: /Upcoming/ }).click()
  await expect(page.getByRole('region', { name: 'upcoming jobs' })).toContainText('Future repair')
  await page.getByRole('button', { name: /History/ }).click()
  await expect(page.getByRole('region', { name: 'history jobs' })).toContainText('Completed repair')
  await page.goto('/?view=schedule')
  await expect(page.locator('.appointment-row')).toContainText('Visit 1')
})

for (const width of [1280, 390]) test(`Add entry creates reminders from the schedule tile at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 })
  const state = await openDashboard(page, { reminders: Array.from({ length: 18 }, (_, n) => reminder(n)) })
  await expect(page.getByRole('region',{name:'Financial Performance',exact:true})).toBeVisible()
  await expect(page.getByRole('article',{name:'Needs attention overview',exact:true})).toBeVisible()
  const tile = page.getByRole('region', { name: 'Work calendar' })
  await expect(page.getByRole('heading', { name: 'Reminders due', exact: true })).toHaveCount(0)
  await expect(tile.getByRole('button', { name: '+ Reminder', exact: true })).toHaveCount(0)
  await tile.getByRole('button', { name: 'Add to calendar', exact: true }).click()
  const dialog=page.getByRole('dialog',{name:'Add to your calendar'})
  await dialog.getByRole('button',{name:'Reminder',exact:true}).click()
  await dialog.getByLabel('Title',{exact:true}).fill('Order replacement parts')
  await dialog.getByLabel('Remind me on').fill(localDatetime(2))
  await dialog.getByRole('button', { name: 'Add reminder', exact: true }).evaluate(button => { button.click(); button.click() })
  await expect(dialog).toHaveCount(0)
  expect(count(state, '/reminders', 'POST')).toBe(1)
  expect(state.reminders.at(-1).job_id).toBeNull()
  expect(state.reminders.at(-1).business_id).toBe(BID)
  await page.goto('/?view=reminders')
  await expect(page.getByRole('region', { name: 'Pending reminders' })).toContainText('Order replacement parts')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('calendar reminders can be linked to a job', async ({ page }) => {
  const job = { id: id(511), title: 'Kitchen repair', status: 'in_progress', scheduled_start: null, customer_id: CID, customers: customer }
  const state = await openSchedule(page, { jobs: [job] })
  await page.goto('/?view=reminders')
  await page.getByRole('button', { name: '+ New reminder' }).click()
  await page.getByLabel('Related job (optional)').selectOption(job.id)
  await expect(page.getByLabel('Related job (optional)')).toHaveValue(job.id)
  await expect(page.getByLabel('Related job (optional)')).toBeEnabled()
  await page.getByLabel('What needs to be done?').fill('Confirm customer access')
  await page.getByLabel('Remind me on').fill(localDatetime(1))
  await page.getByRole('button', { name: 'Save reminder' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Reminder created.' })).toBeVisible()
  expect(state.reminders[0].job_id).toBe(job.id)
  expect(state.reminders[0].customer_id).toBe(CID)
})

test('calendar dashboard shows daily work, overdue reminders, completion, and another date', async ({ page }) => {
  await mockWorkspace(page,{reminders:[{...reminder(2),note:'Confirm materials'}]})
  await page.route('**/rest/v1/calendar_work?**', route => route.fulfill({ contentType: 'application/json', headers:{'access-control-expose-headers':'content-range','content-range':'0-0/1'}, body: JSON.stringify([{source_key:'job:qa',title:'Roof inspection',description:'',starts_at:new Date().toISOString(),ends_at:new Date(Date.now()+3600000).toISOString(),status:'scheduled',document_kind:'work',document_id:id(1)}]) }))
  await page.goto('/?view=dashboard')
  const calendar = page.getByRole('region', {name:'Work calendar'})
  await expect(calendar.getByRole('heading',{name:'Weekly Schedule'})).toBeVisible()
  await expect(calendar.getByRole('link',{name:'Roof inspection'})).toBeVisible()
  await expect(page.getByRole('region',{name:'Needs Attention',exact:true}).getByText('Confirm materials',{exact:true})).toBeVisible()
  await page.getByRole('region',{name:'Needs Attention',exact:true}).getByRole('button',{name:'Complete Confirm materials'}).click()
  await expect(page.getByRole('region',{name:'Needs Attention',exact:true}).getByText('Confirm materials',{exact:true})).toHaveCount(0)
  await expect(calendar.getByLabel('Calendar date')).toHaveCount(0)
  await calendar.getByRole('button',{name:'Next week'}).click()
  await expect(calendar.getByRole('heading',{name:'Weekly Schedule'})).toBeVisible()
})

test('calendar settings shows connected identity, calendar choices and persists toggle', async ({ page }) => {
  await mockWorkspace(page,{plan:'basic'})
  let saved
  await page.route('**/api/calendar?**', route => {
    const action = new URL(route.request().url()).searchParams.get('action')
    if (route.request().method()==='PATCH') {saved=route.request().postDataJSON();return route.fulfill({contentType:'application/json',body:'{"ok":true}'})}
    const result=action==='calendars'?{calendars:[{id:'work',name:'Work Calendar'}]}:{integrations:[{id:id(3),provider:'google',email:'owner@example.test',calendar_id:'work',calendar_name:'Work Calendar',auto_sync:false,state:'connected',last_error:null,last_synced_at:null}]}
    return route.fulfill({contentType:'application/json',body:JSON.stringify(result)})
  })
  await page.goto('/?view=settings')
  await page.getByRole('link',{name:/^Calendar Connections/}).click()
  await expect(page.getByText('owner@example.test',{exact:true})).toBeVisible()
  await page.getByRole('switch').check()
  await page.getByRole('button',{name:'Save calendar settings'}).click()
  await expect.poll(()=>saved?.autoSync).toBe(true)
  await expect(page.getByRole('button',{name:'Connect Microsoft Outlook'})).toBeVisible()
})

test('calendar widget fits a phone without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({width:390,height:844})
  await mockWorkspace(page,{businessProfile:{name:'Barone Landscaping and Property Maintenance',logo_path:BID+'/logo.png'}})
  await page.route('**/storage/v1/object/public/velnu-business-logos/**',route=>route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR1sAAAAASUVORK5CYII=','base64')}))
  await page.route('**/rest/v1/calendar_work?**', route=>route.fulfill({contentType:'application/json',headers:{'access-control-expose-headers':'content-range','content-range':'*/0'},body:'[]'}))
  await page.goto('/?view=dashboard')
  const calendar=page.getByRole('region',{name:'Work calendar'})
  await expect(calendar).toBeVisible()
  expect(await calendar.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true)
  const heading=page.getByRole('heading',{level:1,name:'Barone Landscaping and Property Maintenance'})
  await expect(heading).toBeVisible()
  const logo=page.locator('.dashboard-business-header').getByRole('img',{name:'Barone Landscaping and Property Maintenance logo'})
  await expect(logo).toBeVisible()
  await expect.poll(()=>logo.evaluate(img=>img.naturalWidth)).toBeGreaterThan(0)
  const header=await page.locator('.dashboard-business-header').boundingBox(),quickLinks=await page.getByRole('button',{name:'Quick Links',exact:true}).boundingBox();expect((await heading.boundingBox()).y).toBeGreaterThanOrEqual(header.y);expect(quickLinks.y).toBeGreaterThanOrEqual(header.y);expect(quickLinks.y+quickLinks.height).toBeLessThanOrEqual(header.y+header.height+1)
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
})

test('dashboard layout uses the business name, presents calendar and financials together, and opens Jobs through navigation', async ({ page }) => {
  await openDashboard(page)
  const heading=page.getByRole('heading',{level:1,name:'Velnu QA',exact:true})
  await expect(heading).toBeVisible()
  await expect(page.locator('.dashboard-business-header')).not.toContainText(/your attention|caught up|organized/i)
  await expect(page.locator('.dashboard-business-header img')).toHaveCount(0)
  const header=await page.locator('.dashboard-business-header').boundingBox(),quickLinks=await page.getByRole('button',{name:'Quick Links',exact:true}).boundingBox();expect((await heading.boundingBox()).y).toBeGreaterThanOrEqual(header.y);expect(quickLinks.y).toBeGreaterThanOrEqual(header.y);expect(quickLinks.y+quickLinks.height).toBeLessThanOrEqual(header.y+header.height+1)
  const calendar = page.getByRole('region', { name: 'Work calendar' })
  const financial=page.getByRole('region',{name:'Financial Performance',exact:true}),attention=page.getByRole('article',{name:'Needs attention overview',exact:true})
  await expect(calendar).toBeVisible();await expect(financial).toBeVisible();await expect(attention).toBeVisible()
  expect(await calendar.evaluate((el)=>Boolean(el.compareDocumentPosition(document.querySelector('.financial-performance')) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true)
  await expect(page.getByRole('article',{name:'Jobs overview',exact:true})).toHaveCount(0)
  await page.getByRole('navigation').getByRole('button',{name:'Jobs',exact:true}).click()
  await expect(page.getByRole('heading', { name: 'Jobs', exact:true })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Job workspace views' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'New job', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Open filters', exact: true }).click()
  await expect(page.getByRole('navigation', { name: 'Additional job filters' })).toContainText('History')
})

for (const kind of ['job', 'estimate', 'invoice']) {
  test(`record resources: ${kind} picture and expense persist, remove, and appear once in the workbook`, async ({ page }) => {
    const recordId = id(701)
    const record = { id: recordId, title: 'Kitchen repair', status: kind === 'job' ? 'in_progress' : 'draft', scheduled_start: null,
      customer_id: CID, customers: customer, invoice_number: 'INV-701', estimate_number: 'EST-701',
      issue_date: todayISO(), due_date: todayISO(), subtotal: 100, tax_amount: 0, total: 100, amount_paid: 0, balance_due: 100 }
    const state = await mockWorkspace(page, { jobs: [record], estimates: [record], invoices: [record] })
    const openRecord = async () => {
      await page.goto(kind === 'job' ? '/?view=work&document='+recordId : `/?view=${kind}s&document=${recordId}`,{waitUntil:'domcontentloaded'})
      if (kind === 'job') {
        await page.getByRole('dialog').getByRole('tab',{name:'Photos & expenses',exact:true}).click()
      } else if (kind === 'estimate') {
        await page.getByRole('dialog',{name:'Estimate preview'}).getByRole('tab',{name:'Photos & expenses',exact:true}).click()
      } else await page.getByRole('tab',{name:'Photos & expenses',exact:true}).click()
    }
    await openRecord()
    const panel = page.getByRole('region', { name: 'Photos and expenses' })
    await expect(panel.getByText('No photos yet.')).toBeVisible()
    await panel.getByLabel(kind === 'job' ? 'Add job photos' : 'Add photos').setInputFiles({ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('invalid image') })
    await expect(panel.getByRole('alert')).toContainText('This picture could not be opened')
    expect(state.storageWrites).toBe(0)
    await panel.getByLabel(kind === 'job' ? 'Add job photos' : 'Add photos').setInputFiles({ name: 'job-photo.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAFElEQVR4nGNkaGhgwAaYsIoOWgkAzIgBEFCQDcoAAAAASUVORK5CYII=', 'base64') })
    await expect(panel.getByRole('img', { name: 'job-photo.png' })).toBeVisible()
    expect(state.storageWrites).toBe(1)
    expect(state.photos[0][`${kind}_id`]).toBe(recordId)
    expect(state.photos[0].media_type).toBe('image/jpeg')
    await panel.getByRole('button', { name: 'Add expense manually', exact: true }).click()
    await panel.getByLabel('Amount ($)').fill('24.75')
    await panel.getByLabel('Description', { exact: true }).fill('Replacement fittings')
    await panel.getByRole('button', { name: 'Save expense', exact: true }).evaluate(button => { button.click(); button.click() })
    await expect(panel.getByRole('region', { name: 'Expenses', exact: true }).locator('.record-resources-head')).toContainText('$24.75')
    expect(state.expenses).toHaveLength(1)
    expect(state.expenses[0][`${kind}_id`]).toBe(recordId)
    expect(state.expenses[0].business_id).toBe(BID)
    expect(state.expenses[0].direction).toBe('expense')
    await openRecord()
    await expect(panel.getByRole('img', { name: 'job-photo.png' })).toBeVisible()
    await expect(panel.getByText('Replacement fittings', { exact: true })).toBeVisible()
    await page.setViewportSize({ width: 390, height: 844 })
    expect(await panel.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    await page.screenshot({ path: `test-results/${kind}-resources-phone.png`, fullPage: true })
    page.on('dialog', dialog => dialog.accept())
    await panel.getByRole('button', { name: 'Remove picture job-photo.png' }).click()
    await expect(panel.getByRole('img')).toHaveCount(0)
    await page.goto('/?view=dashboard')
    await page.locator('.performance-metric.expense').click()
    await expect(page.locator('.transaction-list > li').filter({ hasText: 'Replacement fittings' })).toHaveCount(1)
    expect(state.invoices[0].total).toBe(100)
  })
}

test('record resources: viewer cannot upload photos or add expenses', async ({ page }) => {
  await mockWorkspace(page, { role: 'viewer', jobs: [{ id: id(702), title: 'Read only job', status: 'in_progress', scheduled_start: null, customer_id: CID, customers: customer }] })
  await page.goto('/?view=work&document='+id(702))
  await page.getByRole('dialog').getByRole('tab',{name:'Photos & expenses',exact:true}).click()
  const panel = page.getByRole('region', { name: 'Photos and expenses' })
  await expect(panel.getByLabel('Add job photos')).toHaveCount(0)
  await expect(panel.getByRole('button', { name: 'Add expense manually', exact: true })).toHaveCount(0)
  await expect(panel.getByText('Expense records are available to owners, administrators, and office staff.')).toBeVisible()
})

test('record resources: Calendar opens job tabs, preserves notes and retries only the failed photo list', async ({ page }) => {
  const start = DateTime.now().setZone('America/New_York').set({hour:10,minute:0}).toISO()
  const job = {id:id(704),title:'Calendar receipt job',status:'scheduled',description:'Original notes',scheduled_start:start,customer_id:CID,customers:customer}
  const state = await mockWorkspace(page,{jobs:[job],photoLoadFailures:100})
  await page.setViewportSize({width:390,height:844})
  await page.route('**/rest/v1/calendar_work?**', route => route.fulfill({
    json:[{source_key:'job:'+job.id,title:job.title,starts_at:start,ends_at:null,status:'scheduled',document_kind:'work',document_id:job.id,job_id:job.id}],
    headers:{'access-control-expose-headers':'content-range','content-range':'0-0/1'},
  }))
  await page.goto('/?view=dashboard')
  await page.getByRole('region',{name:'Work calendar'}).getByRole('link').filter({hasText:job.title}).click()
  const dialog = page.getByRole('dialog',{name:'Job details',exact:true})
  const notes = dialog.getByLabel('Job notes and materials needed')
  await notes.fill('Unsaved calendar notes')
  await dialog.getByRole('tab',{name:'Details',exact:true}).press('ArrowRight')
  await expect(dialog.getByRole('tab',{name:'Work plan',exact:true})).toHaveAttribute('aria-selected','true')
  await dialog.getByRole('tab',{name:'Work plan',exact:true}).press('ArrowRight')
  await expect(dialog.getByRole('tab',{name:'Photos & expenses',exact:true})).toHaveAttribute('aria-selected','true')
  const resources = dialog.getByRole('region',{name:'Photos and expenses'})
  await expect(resources.getByText('No expenses yet.')).toBeVisible()
  await expect(resources.getByRole('alert')).toContainText('Photos temporarily unavailable')
  const expenseReads=state.requests.filter(request=>request.path.endsWith('/bookkeeping_entries')&&new URL(request.url).searchParams.has('job_id')).length
  state.photoLoadFailures=0
  await resources.getByRole('button',{name:'Try photos again',exact:true}).click()
  await expect(resources.getByText('No photos yet.')).toBeVisible()
  expect(state.requests.filter(request=>request.path.endsWith('/bookkeeping_entries')&&new URL(request.url).searchParams.has('job_id'))).toHaveLength(expenseReads)
  await expect(resources.getByRole('button',{name:/refresh/i})).toHaveCount(0)
  await expect(resources.getByRole('progressbar')).toHaveCount(0)
  await dialog.getByRole('tab',{name:'Details',exact:true}).click()
  await expect(notes).toHaveValue('Unsaved calendar notes')
})

test('record resources: an invoice links directly to its job photos without copying expenses', async ({ page }) => {
  const job = {id:id(705),title:'Linked repair',status:'completed',customer_id:CID,customers:customer}
  const invoice = {...reviewDocument(706),job_id:job.id}
  const state = await mockWorkspace(page,{jobs:[job],invoices:[invoice]})
  state.expenses.push({id:id(707),business_id:BID,job_id:job.id,direction:'expense',entry_date:receiptDay(),amount:25,category:'Materials',description:'One job receipt',currency:'USD'})
  await page.goto('/?view=invoices&document='+invoice.id)
  await page.getByRole('tab',{name:'Photos & expenses',exact:true}).click()
  const invoicePanel = page.getByRole('tabpanel',{name:'Photos & expenses',exact:true})
  await expect(invoicePanel.getByText('No expenses yet.')).toBeVisible()
  await invoicePanel.getByRole('link',{name:'View linked job photos & expenses'}).click()
  const jobDialog = page.getByRole('dialog',{name:'Job details',exact:true})
  await expect(jobDialog.getByRole('tab',{name:'Photos & expenses',exact:true})).toHaveAttribute('aria-selected','true')
  await expect(jobDialog.getByText('One job receipt',{exact:true})).toBeVisible()
  expect(state.expenses).toHaveLength(1)
  expect(state.requests.filter(request=>request.path.endsWith('/bookkeeping_entries')&&request.method==='POST')).toHaveLength(0)
})

for (const width of [1440, 390]) {
  test(`billing hub combines billing without hiding actions at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 })
    const invoices = Array.from({ length: 6 }, (_, n) => ({ id:id(800+n), invoice_number:`INV-${800+n}`, status:n === 5 ? 'paid' : 'sent',
      issue_date:'2026-10-01', created_at:`2026-11-01T1${n}:00:00Z`, due_date:'2020-01-01', total:450, balance_due:n === 5 ? 0 : 450, amount_paid:n === 5 ? 450 : 0, customer_id:CID,
      customers:{...customer,company:null}, jobs:{title:'Electrical wiring service'} }))
    const estimates = Array.from({ length: 3 }, (_, n) => ({ id:id(820+n), estimate_number:`EST-${820+n}`, status:n === 2 ? 'draft' : 'sent',
      issue_date:'2026-10-02', created_at:`2026-11-01T1${n}:30:00Z`, total:1250, customer_id:CID,
      customers:{first_name:null,last_name:null,company:'Acme Corp'}, jobs:{title:'HVAC installation'} }))
    const jobs = [{id:id(850),title:'Kitchen renovation',status:'in_progress',customers:customer},{id:id(851),title:'Water heater replacement',status:'scheduled',customers:customer},{id:id(852),title:'Plumbing maintenance',status:'lead',customers:customer}]
    await openDashboard(page, { invoices, estimates, jobs, aggregate:{open_invoices:5,outstanding_balance:2250} })
    const hub = page.getByRole('article', {name:'Needs attention overview'})
    const switcher=hub.getByRole('group',{name:'Home work queue'})
    await expect(switcher.getByRole('button',{name:'Needs Attention 5',exact:true})).toBeVisible()
    await expect(switcher.getByRole('button',{name:/^Awaiting Customer Approval 2/})).toBeVisible()
    await expect(page.getByRole('region',{name:'Financial Performance',exact:true})).toBeVisible()
    const attention=hub.getByRole('region',{name:'Needs Attention',exact:true})
    await expect(attention.getByRole('listitem')).toHaveCount(5)
    await expect(attention).toContainText('Overdue')
    await expect(attention).not.toContainText('INV-805')
    await expect(hub).toContainText('Showing 1–5 of 5')
    await switcher.getByRole('button',{name:/^Awaiting Customer Approval 2/}).click()
    const approvals=hub.getByRole('region',{name:'Awaiting Customer Approval',exact:true})
    await expect(approvals.getByRole('listitem')).toHaveCount(2)
    await expect(approvals).not.toContainText('EST-822')
    await expect(approvals.getByRole('link',{name:'Open estimate EST-820 for Acme Corp'})).toHaveAttribute('href',`/?view=estimates&document=${id(820)}`)
    await expect(page.getByRole('article',{name:'Jobs overview'})).toHaveCount(0)
    await expect(page.getByRole('navigation').getByRole('button',{name:'Jobs',exact:true})).toHaveCount(1)
    await page.getByRole('button',{name:'Quick Links',exact:true}).click()
    await expect(page.getByRole('navigation',{name:'Create work and quick links'}).getByRole('link',{name:'+ New job',exact:true})).toHaveCount(1)
    await page.getByRole('dialog',{name:'Quick Links',exact:true}).getByRole('button',{name:'Close',exact:true}).click()
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true)
    await expect(page.locator('.financial-transactions')).toHaveCount(0)
    await expect(page.getByRole('heading',{name:'Tell Finviant Office what needs to get done.'})).toHaveCount(0)
    await page.screenshot({path:`test-results/dashboard-billing-${width}.png`,fullPage:true})
    await approvals.getByRole('link',{name:'Open estimate EST-820 for Acme Corp'}).click()
    await expect(page.getByRole('dialog',{name:'Estimate preview'})).toBeVisible()
    expect(new URL(page.url()).searchParams.get('document')).toBe(id(820))
    await page.goto('/?view=estimates')
    await expect(page.locator('.module-record-list').getByRole('article').filter({hasText:'EST-822'})).toContainText('Draft')
    await page.goto('/?view=invoices')
    const outstanding=page.getByRole('button',{name:/Total Outstanding/})
    await expect(outstanding).toContainText('$2,250.00')
    expect(await outstanding.locator('strong').evaluate(el=>el.getBoundingClientRect().height<=Number.parseFloat(getComputedStyle(el).fontSize)*1.5)).toBe(true)
    const paid=page.locator('.module-record-list').getByRole('article').filter({hasText:'INV-805'})
    await expect(paid).toContainText('Paid')
    await paid.getByRole('button',{name:'Open invoice INV-805 for Jane Doe',exact:true}).click()
    await expect(page.getByRole('heading',{name:'INV-805',exact:true})).toBeVisible()
    expect(new URL(page.url()).searchParams.get('document')).toBe(id(805))
    await page.getByRole('navigation').getByRole('button',{name:'Jobs',exact:true}).click()
    await expect(page.getByRole('region',{name:'active jobs',exact:true}).getByRole('article')).toHaveCount(3)
  })
}

test('billing hub empty state and finance restrictions stay honest', async ({page})=>{
  const state=await openDashboard(page)
  const hub=page.getByRole('article',{name:'Needs attention overview'})
  await expect(hub.getByText('No items need attention.')).toBeVisible()
  await page.screenshot({path:'test-results/dashboard-billing-empty.png',fullPage:true})
  await hub.getByRole('group',{name:'Home work queue'}).getByRole('button',{name:/^Awaiting Customer Approval 0/}).click()
  await expect(hub).toContainText('No estimates or change orders are waiting for approval.')
  state.role='technician';state.aggregate={open_invoices:5,outstanding_balance:98765}
  await page.reload()
  await expect(hub).toHaveCount(0)
  await expect(page.getByRole('heading',{name:'Financial Performance',exact:true})).toHaveCount(0)
  await expect(page.locator('body')).not.toContainText('$98,765')
})

test('selected day shows every calendar item while financial detail stays available', async ({page})=>{
  await mockWorkspace(page)
  const items=Array.from({length:7},(_,n)=>({source_key:`job:${n}`,title:`Calendar repair ${n}`,starts_at:new Date().toISOString(),ends_at:null,status:'scheduled',document_kind:'work',document_id:id(n)}))
  await page.route('**/rest/v1/calendar_work?**',route=>route.fulfill({contentType:'application/json',headers:{'access-control-expose-headers':'content-range','content-range':'0-6/7'},body:JSON.stringify(items)}))
  await page.goto('/?view=dashboard')
  const calendar=page.getByRole('region',{name:'Work calendar'})
  await expect(calendar.locator('a.calendar-event')).toHaveCount(7)
  await expect(calendar.getByRole('button',{name:/Show all.*scheduled/})).toHaveCount(0)
  const details=page.locator('.financial-transactions')
  await expect(details).toHaveCount(0)
  await page.locator('.home-financial-trend > summary').click()
  await page.locator('.trend-point').first().click()
  await expect(details).toBeVisible()
})


for (const width of [1440,390]) test(`owner settings navigation is clear at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:900});await mockWorkspace(page,{plan:'pro'})
 const writes=[]
 await page.route('**/rest/v1/business_settings?**',r=>{if(r.request().method()==='POST')writes.push(r.request().postDataJSON());return r.fulfill({contentType:'application/json',body:JSON.stringify({default_tax_rate:0,pricing_adjustment_percent:0,payment_links:[],payment_instructions:''})})})
 await page.route('**/rest/v1/businesses?**',r=>r.fulfill({contentType:'application/json',body:JSON.stringify({...business,...r.request().postDataJSON()})}))
 await page.goto('/?view=settings')
 for(const label of ['Company Profile','Team Management','Invoice & Estimate Setup','Calendar Connections','Subscription'])await expect(page.getByRole('link',{name:new RegExp('^'+label)})).toBeVisible()
 await expect(page.getByRole('button',{name:'Payment options',exact:true})).toHaveCount(0)
 await page.getByRole('link',{name:/^Invoice & Estimate Setup/}).click()
 await page.getByLabel('Default tax rate (%)').fill('5.3')
 await page.getByRole('button',{name:'Save document setup'}).click()
 await expect(page.getByRole('status').filter({hasText:'Document setup saved'})).toBeVisible()
 expect(writes[0].default_tax_rate).toBe(5.3)
 for(const field of ['payment_links','payment_instructions','pricing_adjustment_percent'])expect(writes[0]).not.toHaveProperty(field)
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true)
 await page.screenshot({path:`test-results/owner-settings-${width}.png`,fullPage:true})
})

test('owner settings invites reserve a seat and permissions are editable only through team controls',async({page})=>{
 await page.setViewportSize({width:390,height:844})
 const state=await mockWorkspace(page,{plan:'pro'})
 const team={seat_limit:5,pro:true,members:[{user_id:UID,email:'owner@example.test',role:'owner',primary_owner:true,access_modules:['calendar','jobs','billing','finances']},{user_id:id(902),email:'office@example.test',role:'office',primary_owner:false,access_modules:['calendar','billing']}],invitations:[]}
 const changes=[]
 await page.route('**/rest/v1/rpc/get_team_settings',r=>r.fulfill({contentType:'application/json',body:JSON.stringify(team)}))
 await page.route('**/rest/v1/rpc/manage_team_member',r=>{changes.push(r.request().postDataJSON());return r.fulfill({contentType:'application/json',body:'null'})})
 await page.route('**/functions/v1/team-management',r=>{const b=r.request().postDataJSON();changes.push(b);team.invitations.push({id:id(903),email:b.email,role:b.role,access_modules:b.modules,expires_at:'2026-11-09T12:00:00Z'});return r.fulfill({contentType:'application/json',body:JSON.stringify({url:'https://finviant.com/auth?invite='+'a'.repeat(64),email_status:'unconfirmed',expires_at:'2026-11-09'})})})
 await page.goto('/?view=settings');await page.getByRole('link',{name:/^Team Management/}).click();await page.getByRole('navigation',{name:'Team management sections'}).getByRole('button',{name:'Account Access',exact:true}).click()
 await expect(page.getByText('2 of 5 seats')).toBeVisible()
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true)
 await page.screenshot({path:'test-results/team-settings-phone.png',fullPage:true})
 await page.getByLabel('Email address',{exact:true}).fill('field@example.test')
 await page.getByRole('button',{name:'Send invitation'}).click()
 await expect(page.getByText('3 of 5 seats')).toBeVisible();await expect(page.getByLabel('Private invitation link')).toHaveValue(/invite=/)
 expect(changes[0].modules).toEqual(['calendar','jobs'])
 await page.getByRole('button',{name:'Edit access'}).click()
 const editor=page.getByRole('region',{name:'Edit member access'})
 await editor.getByRole('checkbox',{name:'Estimates & invoices'}).uncheck()
 await editor.getByRole('button',{name:'Save access'}).click()
 await expect.poll(()=>changes.some(c=>c.p_action==='update'&&!c.p_modules.includes('billing'))).toBe(true)
 expect(state.requests.some(r=>r.method==='PATCH'&&r.path.endsWith('/business_members'))).toBe(false)
})

test('owner settings five-seat capacity blocks a sixth invitation',async({page})=>{
 await mockWorkspace(page,{plan:'pro'})
 await page.route('**/rest/v1/rpc/get_team_settings',r=>r.fulfill({contentType:'application/json',body:JSON.stringify({seat_limit:5,pro:true,members:Array.from({length:5},(_,n)=>({user_id:id(n),email:`member${n}@example.test`,role:n?'office':'owner',primary_owner:n===0,access_modules:[]})),invitations:[]})}))
 await page.goto('/?view=settings');await page.getByRole('link',{name:/^Team Management/}).click();await page.getByRole('navigation',{name:'Team management sections'}).getByRole('button',{name:'Account Access',exact:true}).click()
 await expect(page.getByText('5 of 5 seats')).toBeVisible();await expect(page.getByRole('button',{name:'Send invitation'})).toHaveCount(0)
})

test('owner settings restricted staff cannot open hidden modules or owner controls',async({page})=>{
 const state=await mockWorkspace(page,{role:'office',accessModules:['jobs']});await page.goto('/?view=dashboard')
 await expect(page.getByRole('heading',{name:business.name,exact:true})).toBeVisible()
 await expect(page.getByRole('region',{name:'Work calendar'})).toHaveCount(0)
 await expect(page.getByRole('article',{name:'Needs attention overview'})).toHaveCount(0)
 await expect(page.getByRole('heading',{name:'Financial Performance',exact:true})).toHaveCount(0)
 expect(state.requests.some(r=>r.path.endsWith('/rpc/get_dashboard_invoice_totals'))).toBe(false)
 await openWorkArea(page,'Jobs');await expect(page.getByRole('heading',{name:'Jobs',exact:true})).toBeVisible()
 await page.goto('/?view=invoices');await expect(page.getByRole('alert')).toContainText('not included in your access')
 await page.goto('/?view=settings');await expect(page.getByRole('link',{name:/^Team Management/})).toHaveCount(0);await expect(page.getByRole('link',{name:'Subscription',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Payment options',exact:true})).toHaveCount(0)
})

test('owner settings invoice tax defaults and optional cost pricing affect preview and saved lines',async({page})=>{
 await mockWorkspace(page);let payload
 await page.route('**/rest/v1/business_settings?**',r=>r.fulfill({contentType:'application/json',body:JSON.stringify({default_tax_rate:5.3,pricing_adjustment_percent:3,payment_links:[],payment_instructions:''})}))
 await page.route('**/rest/v1/rpc/create_document',r=>{payload=r.request().postDataJSON();return r.fulfill({contentType:'application/json',body:JSON.stringify({id:id(910)})})})
 await page.goto('/?view=invoices');await createWork(page, 'invoice')
 await expect(page.getByLabel('Customer',{exact:true})).toBeVisible()
 await page.getByRole('combobox',{name:'Customer',exact:true}).click();await page.locator('[data-customer-id="'+CID+'"]').click()
 await page.getByPlaceholder('Description',{exact:true}).fill('Service work');await page.getByPlaceholder('Unit price',{exact:true}).fill('100')
 await page.getByText('Tax options · 5.3% default',{exact:true}).click();await expect(page.getByLabel('Default tax rate (%)',{exact:true})).toHaveValue('5.3')
 await expect(page.locator('.estimate-total strong')).toHaveText('$105.30')
 await page.getByRole('checkbox',{name:/Include payment costs/}).check();await expect(page.locator('.estimate-total strong')).toHaveText('$108.46')
 await page.getByRole('button',{name:'Preview',exact:true}).click();await expect(page.getByRole('region',{name:'Invoice PDF',exact:true}).getByRole('button',{name:'Download PDF',exact:true})).toBeEnabled();await expect(page.getByRole('button',{name:'Open saved draft',exact:true})).toBeEnabled();await expect.poll(()=>payload?.payload.items[0].unit_price).toBe(103);expect(payload.payload.items[0].tax_rate).toBe(5.3)
 await page.goto('/?view=estimates');await createWork(page, 'estimate');await page.getByText('Tax options · 5.3% default',{exact:true}).click();await expect(page.getByLabel('Default tax rate (%)',{exact:true})).toHaveValue('5.3');await expect(page.getByRole('checkbox',{name:/Include payment costs/})).toHaveCount(0)
})

test('saved invoice payment links appear on the customer copy and do not record payments',async({page})=>{
 const invoice={id:id(920),invoice_number:'INV-920',status:'sent',issue_date:'2026-11-02',total:100,subtotal:100,tax_amount:0,amount_paid:0,balance_due:100,customer_id:CID,customers:customer,payment_links:[{provider:'venmo',url:'https://venmo.com/business'},{provider:'paypal',url:'https://paypal.me/business'},{provider:'stripe',url:'https://buy.stripe.com/example'},{provider:'cashapp',url:'https://cash.app/$Business'}],payment_instructions:'Use invoice number INV-920.'}
 const state=await mockWorkspace(page,{invoices:[invoice]});await page.goto('/?view=invoices&document='+invoice.id)
 await expect(page.getByRole('region',{name:'Issued invoice PDF'}).getByRole('button',{name:'Download PDF'})).toBeEnabled()
 await expect(page.getByRole('link',{name:/^Pay with /})).toHaveCount(0)
 const token='a'.repeat(64)
 await page.route('**/rest/v1/rpc/get_shared_document',r=>{
  expect(r.request().postDataJSON()).toEqual({p_token:token})
  return r.fulfill({json:{...invoice,kind:'invoice',number:invoice.invoice_number,revision_id:PDF_REVISION,action_state:'payment_due',pro_actions_enabled:false,currency:'USD',company:{name:'Velnu QA',email:null,phone:null},customer:{name:'Jane Doe',email:null,phone:null},items:[]}})
 })
 await page.goto('/?document_share='+token)
 const actions=page.getByRole('region',{name:'Document status and actions'})
 await expect(actions).toContainText('Current balance: $100.00')
 for(const [name,url] of [['Venmo','https://venmo.com/business'],['PayPal','https://paypal.me/business/100.00USD'],['Stripe','https://buy.stripe.com/example?client_reference_id=INV-920'],['Cash App','https://cash.app/$Business']]){
  const link=actions.getByRole('link',{name:'Pay with '+name,exact:true})
  await expect(link).toBeVisible();await expect(link).toHaveAttribute('href',url)
  await expect(link).toHaveAttribute('target','_blank')
 }
 await expect(actions).toContainText('Use invoice number INV-920.')
 expect(state.requests.some(r=>r.path.endsWith('/payments')&&r.method==='POST')).toBe(false)
 expect(state.invoices[0].amount_paid).toBe(0);expect(state.invoices[0].balance_due).toBe(100)
})

test('owner settings cancellation uses explicit confirmation and preserves no-subscription truth',async({page})=>{
 await mockWorkspace(page);const actions=[];let active=true,canceled=false
 await page.route('**/functions/v1/subscription-management',r=>{const b=r.request().postDataJSON();actions.push(b.action);if(b.action==='cancel')canceled=true;return r.fulfill({contentType:'application/json',body:JSON.stringify(active?{active:true,status:'active',can_cancel:true,cancel_at_period_end:canceled,ends_at:'2026-12-02T12:00:00Z'}:{active:false,status:'none',can_cancel:false})})})
 await page.goto('/?view=settings');await page.getByRole('link',{name:'Subscription',exact:true}).click();await page.locator('.settings-panel').getByRole('button',{name:'Cancel subscription',exact:true}).click();expect(actions.every(a=>a==='status')).toBe(true);await page.getByRole('button',{name:'Confirm cancellation'}).click();await expect(page.getByRole('status').filter({hasText:'Cancellation scheduled'})).toContainText('Cancellation scheduled');expect(actions.filter(a=>a==='cancel')).toHaveLength(1);await expect(page.locator('.settings-panel').getByRole('button',{name:'Cancel subscription',exact:true})).toBeDisabled()
 active=false;await page.reload();await expect(page.getByText(/No paid subscription is active/)).toBeVisible();await expect(page.locator('.settings-panel').getByRole('button',{name:'Cancel subscription',exact:true})).toBeDisabled()
})

test('owner settings invitation acceptance bypasses company creation and separate plan selection',async({page})=>{
 await mockWorkspace(page);let accepted=false
 await page.route('**/rest/v1/rpc/accept_team_invitation',r=>{expect(r.request().postDataJSON().p_hash).toMatch(/^[a-f0-9]{64}$/);accepted=true;return r.fulfill({contentType:'application/json',body:JSON.stringify(BID)})})
 await page.goto('/auth?invite='+'a'.repeat(64));await page.getByRole('button',{name:'Accept invitation',exact:true}).click();await expect.poll(()=>accepted).toBe(true);await expect(page.getByRole('region',{name:'Work calendar'})).toBeVisible();expect(await page.evaluate(uid=>localStorage.getItem('finviant-active-business:'+uid),UID)).toBe(BID)
})


for (const width of [1440,390]) test(`interactive dashboard week and month calendar selects work at ${width}px`,async({page})=>{
 // Anchor one month before leap day: elapsed navigation must not grow with wall-clock time.
 const day=DateTime.fromISO('2028-01-15',{zone:'America/New_York'}).startOf('day')
 await page.clock.setFixedTime(day.plus({hours:12}).toJSDate())
 await page.setViewportSize({width,height:900});await mockWorkspace(page,{now:day.plus({hours:12}).toMillis()})
 const items=[0,1,2].map((offset)=>({source_key:`job:interactive-${offset}`,title:['Kitchen installation','Oak Street repair','HVAC maintenance'][offset],description:'',starts_at:day.plus({days:offset,hours:9}).toISO(),ends_at:day.plus({days:offset,hours:11}).toISO(),status:'scheduled',document_kind:'work',document_id:id(980+offset)}))
 const calls=[]
 await page.route('**/rest/v1/calendar_work?**',r=>{calls.push(r.request().url());return r.fulfill({contentType:'application/json',headers:{'access-control-expose-headers':'content-range','content-range':'0-2/3'},body:JSON.stringify(items)})})
 await page.goto('/?view=dashboard')
 const calendar=page.getByRole('region',{name:'Work calendar'})
 await expect(calendar.getByRole('heading',{name:'Weekly Schedule'})).toBeVisible()
 await expect(calendar.getByRole('link',{name:/Kitchen installation/})).toBeVisible()
 await expect(calendar.getByRole('button',{name:'Today',exact:true})).toBeEnabled()
 await expect(calendar.getByRole('button',{name:/Open (calendar|schedule)/})).toHaveCount(0)
 await calendar.getByRole('button',{name:'Month',exact:true}).click()
 await expect(calendar.getByLabel('Calendar month')).toHaveCount(0)
 await expect(calendar.getByRole('heading',{name:'Monthly calendar'})).toBeVisible()
 await calendar.getByRole('button',{name:new RegExp(day.plus({days:1}).toLocaleString(DateTime.DATE_FULL))}).click()
 await expect(page.getByRole('dialog',{name:'Add to your calendar'})).toHaveCount(0)
 await expect(calendar.getByRole('link',{name:/Oak Street repair/})).toBeVisible()
 const before=calls.length
 await calendar.getByRole('button',{name:new RegExp(day.plus({days:2}).toLocaleString(DateTime.DATE_FULL))}).click()
 await expect(page.getByRole('dialog',{name:'Add to your calendar'})).toHaveCount(0)
 await expect(calendar.getByRole('link',{name:/HVAC maintenance/})).toBeVisible()
 expect(calls.length).toBe(before)
 const months=Math.round(DateTime.fromISO('2028-02-01').diff(day.startOf('month'),'months').months)
 for(let i=0;i<Math.abs(months);i++)await calendar.getByRole('button',{name:months>0?'Next month':'Previous month'}).click()
 await expect(calendar.getByRole('button',{name:/February 29, 2028/})).toBeVisible()
 await expect(calendar.getByText('February 2028',{exact:true})).toBeVisible()
 await calendar.getByRole('button',{name:'Next month'}).click();await expect(calendar.getByText('March 2028',{exact:true})).toBeVisible()
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true)
 await page.screenshot({path:`test-results/interactive-calendar-month-${width}.png`,fullPage:true})
 await calendar.getByRole('button',{name:'Today',exact:true}).click();await expect(calendar.getByText(day.toFormat('MMMM yyyy'),{exact:true})).toBeVisible()
 await calendar.getByRole('button',{name:'Week',exact:true}).click();await expect(calendar.getByLabel('Calendar date')).toHaveCount(0);await expect(calendar.getByRole('link',{name:/Kitchen installation/})).toBeVisible()
})

async function mockInteractiveFinances(page) {
 const now=DateTime.now().setZone('America/New_York').startOf('month')
 const invoice={id:id(990),invoice_number:'INV-990',status:'sent',issue_date:now.toISODate(),total:100,subtotal:100,tax_amount:0,amount_paid:0,balance_due:100,customer_id:CID,customers:customer}
 const job={id:id(991),title:'Kitchen installation',status:'in_progress',scheduled_start:null,customer_id:CID,customers:customer}
 await mockWorkspace(page,{plan:'pro',invoices:[invoice],jobs:[job],estimates:[{id:id(992),estimate_number:'EST-992',status:'sent',total:650,issue_date:now.toISODate(),customer_id:CID,customers:customer}]})
 const payments=[{id:id(993),invoice_id:invoice.id,amount:100,paid_at:now.plus({hours:12}).toISO(),status:'succeeded',method:'cash',invoices:{invoice_number:'INV-990'}},{id:id(994),invoice_id:invoice.id,amount:50,paid_at:now.minus({months:2}).plus({hours:12}).toISO(),status:'succeeded',method:'paypal',invoices:{invoice_number:'INV-990'}}]
 const manual=Array.from({length:32},(_,index)=>({id:id(1000+index),amount:1,entry_date:now.toISODate(),direction:'expense',description:index===0?'Copper fittings':`Materials ${index+1}`,category:'Materials',currency:'USD',job_id:index===0?job.id:null,jobs:index===0?{title:job.title}:null,notes:index===0?'Receipt from local hardware store':null}))
 manual.push({id:id(1100),amount:25,entry_date:now.minus({months:5}).toISODate(),direction:'income',description:'Consultation',category:'Service',currency:'USD'},{id:id(1101),amount:10,entry_date:now.minus({months:11}).toISODate(),direction:'expense',description:'Older tools',category:'Tools',currency:'USD'})
 await page.route('**/rest/v1/rpc/list_invoice_cash_activity**',r=>{
  const body=r.request().postDataJSON(),q=new URL(r.request().url()).searchParams;expect(body.p_business).toBe(BID)
  const rows=payments.filter(row=>(!body.p_from||Date.parse(row.paid_at)>=Date.parse(body.p_from))&&(!body.p_to||Date.parse(row.paid_at)<Date.parse(body.p_to))).map(row=>({id:row.id,invoice_id:row.invoice_id,invoice_number:row.invoices.invoice_number,direction:'income',amount:row.amount,currency:'USD',method:row.method,occurred_at:row.paid_at}))
  const offset=Number(q.get('offset')||0),limit=Number(q.get('limit')||1000),pageRows=rows.slice(offset,offset+limit)
  return r.fulfill({json:pageRows,headers:{'access-control-expose-headers':'content-range','content-range':`${offset}-${Math.max(offset,offset+pageRows.length-1)}/${rows.length}`}})
 })
 for(const [table,rows,dateField] of [['payments',payments,'paid_at'],['bookkeeping_entries',manual,'entry_date']])await page.route(`**/rest/v1/${table}?**`,r=>{
  const q=new URL(r.request().url()).searchParams
  expect(q.get('business_id')).toBe('eq.'+BID)
  const filtered=rows.filter(row=>q.getAll(dateField).every(filter=>filter.startsWith('gte.')?Date.parse(row[dateField])>=Date.parse(filter.slice(4)):filter.startsWith('lt.')?Date.parse(row[dateField])<Date.parse(filter.slice(3)):true))
  const offset=Number(q.get('offset')||0),limit=Number(q.get('limit')||1000)
  return r.fulfill({contentType:'application/json',headers:{'access-control-expose-headers':'content-range','content-range':`${offset}-${offset+filtered.slice(offset,offset+limit).length-1}/${filtered.length}`},body:JSON.stringify(filtered.slice(offset,offset+limit))})
 })
 return {now,invoice,job}
}
for (const width of [1440,390]) test(`interactive dashboard financial periods expand complete transactions and sources at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:900});const {now,invoice,job}=await mockInteractiveFinances(page)
 await page.goto('/?view=dashboard')
 const finance=page.getByRole('region',{name:'Financial Performance',exact:true})
 await expect(finance.getByRole('button',{name:'1 month',exact:true})).toHaveAttribute('aria-pressed','true')
 await finance.getByRole('button',{name:'6 months',exact:true}).click()
 await finance.locator('.home-financial-trend > summary').click()
 const income=finance.locator('.performance-metric.income'),expenses=finance.locator('.performance-metric.expense'),net=finance.locator('.performance-metric.all')
 await expect(income).toContainText('$175.00');await expect(expenses).toContainText('$32.00');await expect(net).toContainText('$143.00')
 await page.screenshot({path:`test-results/interactive-dashboard-${width}.png`,fullPage:true})
 await income.click();let details=finance.getByRole('region',{name:'Income transactions',exact:true})
 await expect(details.locator('.transaction-list > li')).toHaveCount(3)
 await expect(details.getByText(/Invoice payment · paypal/)).toBeVisible()
 await expect(details.getByRole('link',{name:/View invoice/}).first()).toHaveAttribute('href','/?view=invoices&document='+invoice.id)
 await expenses.click();details=finance.getByRole('region',{name:'Expense transactions',exact:true})
 await expect(details.locator('.transaction-list > li')).toHaveCount(25)
 await expect(details.getByText('1–25 of 32',{exact:true})).toBeVisible()
 await details.getByRole('button',{name:'Next',exact:true}).click();await expect(details.locator('.transaction-list > li')).toHaveCount(7)
 await expect(details.getByText('Materials 32',{exact:true})).toBeVisible()
 await details.getByLabel('Search transactions').fill('Copper')
 await expect(details.locator('.transaction-list > li')).toHaveCount(1)
 await expect(details.getByText('Job expense · Kitchen installation',{exact:true})).toBeVisible()
 await expect(details.getByRole('link',{name:/View job/})).toHaveAttribute('href','/?view=work&document='+job.id)
 await page.screenshot({path:`test-results/interactive-financial-details-${width}.png`,fullPage:true})
 await net.click();await expect(finance.getByRole('region',{name:'All transactions',exact:true})).toContainText('1–25 of 35')
 for(const [period,expected] of [[1,'$68.00'],[3,'$118.00'],[12,'$133.00']]){
  await finance.getByRole('button',{name:period+' '+(period===1?'month':'months'),exact:true}).click()
  await expect(net).toContainText(expected)
  await expect(finance.locator('.trend-point')).toHaveCount(period===1?now.daysInMonth:period)
 }
 await finance.locator('.trend-point').first().focus();await page.keyboard.press('Enter')
 await expect(finance.getByRole('region',{name:'All transactions',exact:true})).toContainText('Older tools')
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true)
 await page.goto('/?view=work&document='+job.id)
 await expect(page.getByRole('dialog')).toContainText('Kitchen installation')
})
test('interactive dashboard financial failure does not show invented zero totals',async({page})=>{
 await mockWorkspace(page)
 await page.route('**/rest/v1/rpc/list_invoice_cash_activity**',r=>r.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'Payments unavailable'})}))
 await page.goto('/?view=dashboard')
 const finance=page.getByRole('region',{name:'Financial Performance',exact:true})
 await expect(finance.getByRole('alert').filter({hasText:'Payments unavailable'})).toBeVisible({timeout:15000})
 await expect(finance.locator('.performance-metric.income')).toBeDisabled()
 await expect(finance.locator('.performance-metrics')).not.toContainText('$0.00')
 await expect(finance.getByRole('button',{name:'Retry financial data'})).toBeVisible()
})


test('interactive dashboard navigation does not treat an invoice link as a job link',async({page})=>{
 const {invoice}=await mockInteractiveFinances(page)
 await page.goto('/?view=invoices&document='+invoice.id)
 await expect(page.getByRole('link',{name:'Pay with PayPal',exact:true})).toHaveCount(0)
 await page.getByRole('button',{name:'Home',exact:true}).click()
 await page.getByRole('navigation').getByRole('button',{name:'Jobs',exact:true}).click()
 await expect(page.getByRole('heading',{name:'Jobs',exact:true})).toBeVisible()
 await expect(page.getByRole('article').filter({hasText:'Kitchen installation'})).toBeVisible()
 await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('volume lists reach historical invoices beyond 1000 and keep 25 rows per page',async({page})=>{
 const invoices=Array.from({length:1100},(_,i)=>({id:id(10000+i),invoice_number:`QA-${String(i).padStart(4,'0')}`,status:'draft',issue_date:'2026-01-01',due_date:'2026-01-31',subtotal:100,tax_amount:0,total:100,amount_paid:0,balance_due:100,customer_id:CID,customers:customer}))
 await mockWorkspace(page,{invoices})
 await page.goto('/?view=invoices')
 await expect(page.getByText('1100 records · Page 1 of 44')).toBeVisible()
 await expect(page.locator('.invoice-list-row')).toHaveCount(25)
 await page.getByRole('searchbox',{name:'Search invoices'}).fill('QA-0000')
 await expect(page.getByText('1 records · Page 1 of 1')).toBeVisible()
 await expect(page.getByRole('button',{name:/QA-0000/})).toBeVisible()
 await createWork(page, 'invoice')
 await page.getByLabel('Issue date',{exact:true}).fill('2026-01-01')
 await page.getByLabel('Due date',{exact:true}).fill('2026-01-31')
 await expect(page.getByLabel('Issue date',{exact:true})).toHaveValue('2026-01-01')
})


for(const width of [1440,390])test(`invoice creates one linked scheduled job with minimal input at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:900})
 const inv={id:id(300),invoice_number:'INV-JOB',status:'sent',issue_date:'2026-11-01',due_date:'2099-01-01',subtotal:100,tax_amount:0,total:100,balance_due:100,amount_paid:0,customer_id:CID,customers:customer,job_id:null}
 const state=await mockWorkspace(page,{invoices:[inv]});await page.goto('/?view=invoices&document='+inv.id)
 await page.getByRole('region',{name:'Record actions',exact:true}).locator('summary').click()
 await page.getByRole('button',{name:'Schedule job',exact:true}).click()
 const dialog=page.getByRole('dialog',{name:'Schedule job from invoice'})
 await expect(dialog).toContainText('Jane Doe');await expect(dialog).toContainText('Faucet repair × 1')
 await expect(dialog.getByLabel('Service address',{exact:true})).toHaveValue(id(77))
 await dialog.getByLabel(/Agreed start/).fill('2026-12-07T10:00')
 await dialog.getByRole('button',{name:'Create job & schedule',exact:true}).click()
 await expect(dialog).toHaveCount(0);await expect(page.getByRole('link',{name:'Open linked job'})).toBeVisible()
 const calls=state.requests.filter(r=>r.path.endsWith('/rpc/book_invoice_job'));expect(calls).toHaveLength(1)
 expect(calls[0].body.p_input.workers).toEqual([UID]);expect(calls[0].body.p_input.property_id).toBe(id(77))
 expect(Date.parse(calls[0].body.p_input.ends_at)-Date.parse(calls[0].body.p_input.starts_at)).toBe(7200000)
 expect(state.jobs).toHaveLength(1);expect(state.appointments).toHaveLength(1);expect(state.invoices[0].status).toBe('sent')
 await page.screenshot({path:'test-results/invoice-job-'+width+'.png',fullPage:true})
})

test('sent invoices need attention only with an unpaid balance before the business calendar day',async({page})=>{
 await page.clock.install({time:new Date('2026-11-04T02:00:00Z')}) // November 3 in New York
 const invoices=[['FUTURE','sent','2026-11-05',100],['TODAY','sent','2026-11-03',100],['NO-DUE','sent',null,100],['OVERDUE','sent','2026-11-02',100],['PARTIAL','partial','2026-11-02',20],['PAID','paid','2026-11-02',0],['DRAFT','draft','2026-11-02',100],['VOID','void','2026-11-02',100]].map(([number,status,due,balance],n)=>({id:id(310+n),invoice_number:'INV-'+number,status,due_date:due,balance_due:balance,total:100,issue_date:'2026-11-01',customers:customer}))
 const state=await mockWorkspace(page,{invoices,attentionNow:Date.parse('2026-11-04T02:00:00Z'),sessionTTL:259200,aggregate:{open_invoices:5,outstanding_balance:420}});await page.goto('/?view=dashboard')
 const attention=page.getByRole('region',{name:'Needs Attention',exact:true})
 await expect(attention.getByRole('link',{name:/Open invoice INV-OVERDUE/})).toBeVisible()
 await expect(attention.getByRole('link',{name:/Open invoice INV-PARTIAL/})).toBeVisible()
 for(const number of ['FUTURE','TODAY','NO-DUE','PAID','DRAFT','VOID'])await expect(attention.getByRole('link',{name:new RegExp('Open invoice INV-'+number)})).toHaveCount(0)
 const query=state.requests.find(r=>r.path.endsWith('/invoices')&&new URL(r.url).searchParams.has('due_date'))
 expect(new URL(query.url).searchParams.get('due_date')).toBe('lt.2026-11-03')
 await expect(page.getByRole('group',{name:'Needs Attention categories'}).getByRole('button',{name:'Overdue invoices 2',exact:true})).toBeVisible()
 await page.goto('/?view=invoices');await expect(page.getByRole('button',{name:/Total Outstanding/})).toContainText('$420.00')
})

for(const width of [1440,390])test(`all attention actions use one color and size at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:900})
 await mockWorkspace(page,{reminders:[reminder(700)],invoices:[{id:id(701),invoice_number:'INV-OLD',status:'sent',issue_date:'2020-01-01',due_date:'2020-01-02',total:100,balance_due:100,customers:customer}],workflow:{approved:[{id:id(702),estimate_number:'EST-READY',customer_name:'Jane Doe',offer:null}],completed:[{id:id(703),title:'Finished work',invoice_id:id(704),invoice_status:'draft'}]}})
 await page.goto('/?view=dashboard');const attention=page.getByRole('region',{name:'Needs Attention',exact:true})
 await expect(attention.locator('.attention-action')).toHaveCount(3)
 await expect(attention.locator('.billing-reminder-row').getByRole('button',{name:'Send reminder',exact:true})).toBeEnabled()
 const styles=await attention.locator('.attention-action').evaluateAll(elements=>elements.map(e=>{const s=getComputedStyle(e);return [s.backgroundColor,s.color,s.fontFamily,s.fontSize,s.fontWeight,e.getBoundingClientRect().height,e.getBoundingClientRect().width]}))
 for(const style of styles){expect(style.slice(0,6)).toEqual(styles[0].slice(0,6));expect(style[0]).toBe('rgb(0, 134, 115)');expect(style[5]).toBe(44);if(width>700)expect(style[6]).toBe(176)}
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
 await page.screenshot({path:'test-results/attention-actions-'+width+'.png',fullPage:true})
})


test('lost invoice scheduling response reuses the job and reports its saved schedule on retry',async({page})=>{
 const inv={id:id(390),invoice_number:'INV-RETRY',status:'sent',issue_date:'2026-11-01',due_date:'2099-01-01',subtotal:100,tax_amount:0,total:100,balance_due:100,amount_paid:0,customer_id:CID,customers:customer,job_id:null}
 const state=await mockWorkspace(page,{invoices:[inv],invoiceBookingLost:true});await page.goto('/?view=invoices&document='+inv.id)
 await page.getByRole('region',{name:'Record actions',exact:true}).locator('summary').click()
 await page.getByRole('button',{name:'Schedule job',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Schedule job from invoice'})
 await dialog.getByLabel(/Agreed start/).fill('2026-12-07T10:00');await dialog.getByRole('button',{name:'Create job & schedule',exact:true}).click()
 await expect(dialog.getByRole('alert')).toContainText('Response lost')
 await dialog.getByLabel(/Agreed start/).fill('2026-12-08T10:00');await dialog.getByRole('button',{name:'Create job & schedule',exact:true}).click()
 await expect(dialog).toHaveCount(0);await expect(page.getByText('This invoice already has a job. Open linked job to review its saved appointment.')).toBeVisible()
 expect(state.jobs).toHaveLength(1);expect(state.appointments).toHaveLength(1)
 expect(state.jobs[0].scheduled_start).toBe('2026-12-07T15:00:00.000Z')
 const calls=state.requests.filter(r=>r.path.endsWith('/rpc/book_invoice_job'));expect(calls).toHaveLength(2);expect(calls[0].body.p_request).toBe(calls[1].body.p_request)
})

for(const width of [1440,390])test(`attention pages reach the entire mixed queue and approval list at ${width}px`,async({page})=>{
 test.setTimeout(60000) // This journey traverses all 20 pages, then verifies navigation.
 await page.setViewportSize({width,height:1000})
 const workflow={approved:Array.from({length:23},(_,n)=>({id:id(2000+n),estimate_number:`AP-${n}`,customer_name:'Customer',offer:null})),completed:Array.from({length:22},(_,n)=>({id:id(2100+n),title:`JOB-${n}`,invoice_id:id(2200+n),invoice_status:'draft'}))}
 const reminders=Array.from({length:12},(_,n)=>({...reminder(2300+n),note:`REM-${n}`}))
 const invoices=Array.from({length:14},(_,n)=>({id:id(2400+n),invoice_number:`INV-${n}`,status:'sent',due_date:'2000-01-01',issue_date:'2000-01-01',total:100,balance_due:100,customers:customer}))
 const estimates=Array.from({length:13},(_,n)=>({id:id(2500+n),estimate_number:`EST-${n}`,status:'sent',issue_date:'2000-01-01',total:100,customers:customer}))
 const changeOrders=Array.from({length:11},(_,n)=>({id:id(2600+n),change_order_number:`CO-${n}`,status:'sent',issue_date:'2000-01-01',title:'Additional work',total:100,customers:customer}))
 await openDashboard(page,{workflow,reminders,invoices,estimates,changeOrders})
 const hub=page.getByRole('article',{name:'Needs attention overview'}),queue=hub.getByRole('region',{name:'Needs Attention',exact:true}),pager=hub.getByRole('navigation',{name:'Attention pages'})
 const switcher=hub.getByRole('group',{name:'Home work queue'})
 await expect(switcher.getByRole('button',{name:'Needs Attention 71',exact:true})).toBeVisible()
 await expect(switcher.getByRole('button',{name:/^Awaiting Customer Approval 24/})).toBeVisible()
 await expect(hub.getByRole('button',{name:/new estimate|create invoice|new invoice/i})).toHaveCount(0)
 await expect(hub.getByRole('link',{name:/new estimate|create invoice|new invoice/i})).toHaveCount(0)
 await page.getByRole('button',{name:'Quick Links',exact:true}).click()
 await expect(page.getByRole('navigation',{name:'Create work and quick links'}).getByRole('link',{name:'+ New invoice',exact:true})).toBeVisible()
 await page.getByRole('dialog',{name:'Quick Links',exact:true}).getByRole('button',{name:'Close',exact:true}).click()
 const seen=new Set()
 for(let n=1;n<=15;n++){
  await expect(pager).toContainText(`Page ${n} of 15`)
  await expect(queue.getByRole('listitem')).toHaveCount(n===15?1:5)
  for(const text of await queue.getByRole('listitem').allTextContents()){
   const key=text.match(/(?:AP|JOB|REM|INV)-\d+/)?.[0];expect(key).toBeTruthy();expect(seen.has(key)).toBe(false);seen.add(key)
  }
  if(n<15)await pager.getByRole('button',{name:'Next',exact:true}).click()
 }
 expect(seen.size).toBe(71);await expect(pager.getByRole('button',{name:'Next',exact:true})).toBeDisabled()
 await pager.getByRole('button',{name:'Previous',exact:true}).click();await expect(pager).toContainText('Page 14 of 15')
 await switcher.getByRole('button',{name:/^Awaiting Customer Approval 24/}).click()
 const approvals=hub.getByRole('region',{name:'Awaiting Customer Approval',exact:true}),seenApprovals=new Set()
 for(let n=1;n<=5;n++){
  await expect(pager).toContainText(`Page ${n} of 5`)
  await expect(approvals.getByRole('listitem')).toHaveCount(n===5?4:5)
  for(const text of await approvals.getByRole('listitem').allTextContents()){
   const key=text.match(/(?:EST|CO)-\d+/)?.[0];expect(key).toBeTruthy();expect(seenApprovals.has(key)).toBe(false);seenApprovals.add(key)
  }
  if(n<5)await pager.getByRole('button',{name:'Next',exact:true}).click()
 }
 expect(seenApprovals.size).toBe(24);await expect(pager.getByRole('button',{name:'Next',exact:true})).toBeDisabled()
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
 await page.screenshot({path:`test-results/attention-paging-${width}.png`,fullPage:true})
 await page.getByRole('navigation').getByRole('button',{name:'Estimates',exact:true}).click();await expect(page.getByRole('heading',{name:'Estimates',exact:true})).toBeVisible()
})

test('attention paging clamps after completion and zero counts stay neutral',async({page})=>{
 const state=await openDashboard(page,{reminders:Array.from({length:6},(_,n)=>reminder(n+1))})
 const hub=page.getByRole('article',{name:'Needs attention overview'}),pager=hub.getByRole('navigation',{name:'Attention pages'})
 await expect(pager).toContainText('Page 1 of 2');await pager.getByRole('button',{name:'Next',exact:true}).click();await expect(pager).toContainText('Page 2 of 2')
 await hub.getByRole('button',{name:'Complete Call customer 6',exact:true}).click()
 await expect(pager).toContainText('Showing 1–5 of 5');await expect(attentionCount(page)).toHaveText('5')
 state.reminders=[];await page.evaluate(()=>window.dispatchEvent(new Event('finviant-work-changed')))
 await expect(hub.getByText('No items need attention.',{exact:true})).toBeVisible()
 await expect(attentionCount(page)).toHaveText('0')
 await expect(hub.getByRole('group',{name:'Home work queue'}).getByRole('button',{name:/^Awaiting Customer Approval 0/})).toBeVisible()
 const categories=hub.getByRole('group',{name:'Needs Attention categories'})
 await expect(categories.getByRole('button',{name:'All 0',exact:true})).toBeEnabled()
 await expect(categories.getByRole('button',{name:'Follow-ups due 0',exact:true})).toBeEnabled()
 await expect(pager).toContainText('0 items')
 await expect(pager.getByRole('button',{name:'Next',exact:true})).toHaveCount(0)
 await expect(pager.getByRole('button',{name:'Previous',exact:true})).toHaveCount(0)
})

test('failed attention page is retryable and a delayed response cannot overwrite a newer filter',async({page})=>{
 const state=await openDashboard(page,{reminders:Array.from({length:8},(_,n)=>reminder(n+1)),estimates:[{id:id(2900),estimate_number:'EST-FILTER',status:'sent',issue_date:'2000-01-01',total:10,customers:customer}]})
 const hub=page.getByRole('article',{name:'Needs attention overview'}),pager=hub.getByRole('navigation',{name:'Attention pages'})
 await expect(pager).toContainText('Page 1 of 2');state.attentionFailure=true
 await pager.getByRole('button',{name:'Next',exact:true}).click();await expect(hub.getByRole('alert')).toContainText('Needs Attention is unavailable')
 await expect(hub.getByText('No items need attention.',{exact:true})).toHaveCount(0)
 await expect(attentionCount(page)).toHaveText('—')
 state.attentionFailure=false;await hub.getByRole('button',{name:'Retry',exact:true}).click();await expect(pager).toContainText('Page 2 of 2')
 state.attentionDelay=500
 await pager.getByRole('button',{name:'Previous',exact:true}).click()
 await expect(hub.getByText('Loading attention items…')).toBeVisible()
 await hub.getByRole('group',{name:'Home work queue'}).getByRole('button',{name:/^Awaiting Customer Approval /}).click()
 await expect(hub.getByRole('region',{name:'Awaiting Customer Approval'})).toContainText('EST-FILTER')
 await page.waitForTimeout(650)
 await expect(hub.getByRole('region',{name:'Awaiting Customer Approval'}).getByRole('listitem')).toHaveCount(1)
 await expect(pager).toContainText('Showing 1–1 of 1')
})

const reviewCreated='2026-11-03T14:05:00Z'
const reviewCustomer={...customer,email:'jane@example.test'}
const reviewDocument=(n,status='sent')=>({id:id(n),invoice_number:`INV-${n}`,estimate_number:`EST-${n}`,status,issue_date:'2026-01-15',due_date:'2026-11-30',created_at:reviewCreated,updated_at:'2026-11-03T15:10:00Z',sent_at:'2026-11-03T15:10:00Z',customer_id:CID,customers:reviewCustomer,total:100,subtotal:100,tax_amount:0,amount_paid:0,balance_due:100})
async function assertRecordActions(page,scope=page){
 const bar=scope.getByRole('region',{name:'Record actions',exact:true})
 await expect(bar).toBeVisible()
 const controls=bar.locator('.record-action-primary>button,.record-action-secondary>button,.record-more>summary')
 const sizes=await controls.evaluateAll(nodes=>nodes.map(n=>({height:n.getBoundingClientRect().height,clipped:n.scrollHeight>n.clientHeight+1})))
 expect(sizes.length).toBeGreaterThan(1)
 for(const value of sizes){expect(value.height).toBeGreaterThanOrEqual(44);expect(value.clipped).toBe(false)}
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
}
async function assertCanonicalPdf(page,scope,title){
 const pdf=scope.getByRole('region',{name:title,exact:true})
 await expect(pdf.getByRole('button',{name:'Download PDF',exact:true})).toBeEnabled()
 const toggle=pdf.getByRole('button',{name:'View PDF',exact:true})
 await expect(toggle).toHaveAttribute('aria-expanded','false');await toggle.click()
 await expect(pdf.locator('iframe')).toHaveAttribute('src',/^blob:/)
 await expect(pdf.getByRole('link',{name:'Open PDF',exact:true})).toHaveAttribute('href',/^blob:/)
 const download=page.waitForEvent('download');await pdf.getByRole('button',{name:'Download PDF',exact:true}).click()
 expect((await download).suggestedFilename()).toMatch(/\.pdf$/)
 await pdf.getByRole('button',{name:'Hide PDF',exact:true}).click();await expect(pdf.locator('iframe')).toHaveCount(0)
}
for(const width of [1440,390])test(`invoice review has accessible ordered actions, a canonical PDF and a persistent timestamp at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:1000})
 const inv={...reviewDocument(4001),due_date:'2099-11-30'};await mockWorkspace(page,{invoices:[inv],customers:[reviewCustomer],businessProfile:{timezone:'America/New_York'}})
 await page.goto('/?view=invoices&document='+inv.id)
 const actions=page.getByRole('region',{name:'Record actions',exact:true})
 await expect(actions.locator('.record-action-primary').getByRole('button')).toHaveText('Mark Paid')
 await assertRecordActions(page)
 await actions.locator('summary').click()
 const more=actions.getByRole('group',{name:'More actions',exact:true})
 for(const name of ['Schedule job','Remind me to follow up','Void invoice'])await expect(more.getByRole('button',{name,exact:true})).toBeVisible()
 await expect(more.getByRole('button',{name:'Void invoice',exact:true})).toHaveCSS('color','rgb(158, 40, 40)')
 await actions.locator('summary').press('Escape');await expect(more).toBeHidden()
 const record=page.getByRole('region',{name:'Document record',exact:true})
 await expect(record.locator('time').first()).toHaveText('Nov 3, 2026 · 9:05 AM EST')
 await expect(record).toContainText('Last updated');await expect(record).toContainText('Sent')
 await expect(record.getByRole('link',{name:'Customer record: Jane Doe'})).toHaveAttribute('href','/?view=customers&document='+CID)
 await expect(page.getByRole('tabpanel',{name:'Details',exact:true})).toContainText('2026-01-15')
 await assertCanonicalPdf(page,page,'Issued invoice PDF')
 const resourcesTab=page.getByRole('tab',{name:'Photos & expenses',exact:true})
 await resourcesTab.click();await expect(resourcesTab).toHaveAttribute('aria-selected','true')
 await expect(page.getByRole('region',{name:'Photos and expenses',exact:true})).toBeVisible()
 await page.getByRole('tab',{name:'Details',exact:true}).click();await expect(record).toBeVisible()
 await page.screenshot({path:`test-results/document-review-invoice-${width}.png`,fullPage:true})
 await page.emulateMedia({media:'print'})
 await expect(resourcesTab).toBeHidden();await expect(actions).toBeHidden()
})
for(const width of [1440,390])test(`estimate review has accessible actions, a canonical PDF and document history at ${width}px`,async({page},testInfo)=>{
 // This full PDF/dialog/history journey also captures a full-page 3x WebKit image.
 // Bound the whole Safari journey at 60s; retain every action and assertion.
 if(testInfo.project.name==='iphone-webkit')test.setTimeout(60000)
 await page.setViewportSize({width,height:1000})
 const est={...reviewDocument(4002),sent_at:undefined,expires_on:'2099-11-30'};await mockWorkspace(page,{plan:'pro',estimates:[est],customers:[reviewCustomer],businessProfile:{timezone:'America/New_York'}})
 await page.goto('/?view=estimates&document='+est.id)
 const preview=page.getByRole('dialog',{name:'Estimate preview'})
 await expect(preview).toBeVisible()
 const actions=preview.getByRole('region',{name:'Record actions',exact:true})
 await expect(actions.locator('.record-action-primary').getByRole('button')).toHaveText('Follow up')
 await assertRecordActions(page,preview)
 await actions.locator('summary').click()
 await expect(actions.getByRole('button',{name:'Record acceptance',exact:true})).toBeVisible()
 await actions.locator('summary').press('Escape')
 await assertCanonicalPdf(page,preview,'Estimate PDF')
 await preview.getByRole('tab',{name:'Activity',exact:true}).click()
 const record=preview.getByRole('region',{name:'Document record',exact:true})
 await expect(record.locator('time').first()).toHaveText('Nov 3, 2026 · 9:05 AM EST')
 await expect(record.getByRole('link',{name:'Customer record: Jane Doe'})).toHaveAttribute('href','/?view=customers&document='+CID)
 await page.screenshot({path:`test-results/document-review-estimate-${width}.png`,fullPage:true})
 await page.route('**/functions/v1/create-approval-link',r=>r.fulfill({contentType:'application/json',body:JSON.stringify({token:'a'.repeat(64),relative_url:'/?approval='+'a'.repeat(64),revision_id:PDF_REVISION,expires_at:'2099-11-17T14:00:00Z'})}))
 await actions.locator('summary').click()
 await actions.getByRole('button',{name:'Customer approval link',exact:true}).click()
 const approval=page.getByRole('dialog',{name:'EST-4002 approval link',exact:true})
 await expect(approval.getByRole('textbox',{name:'Approval link'})).toHaveValue(new RegExp('approval='+'a'.repeat(64)+'$'))
 await expect(approval.getByRole('button',{name:'Copy link',exact:true})).toBeVisible()
 await page.keyboard.press('Escape');await expect(approval).toHaveCount(0);await expect(preview).toBeVisible()
 await preview.getByRole('tab',{name:'Photos & expenses',exact:true}).click()
 await expect(preview.getByRole('region',{name:'Photos and expenses',exact:true})).toBeVisible()
 await preview.getByRole('tab',{name:'Activity',exact:true}).click();await expect(record).toBeVisible()
 await preview.getByRole('button',{name:'Close preview',exact:true}).click();await expect(preview).toHaveCount(0)
 await expect(page.getByRole('button',{name:'Open estimate EST-4002 for Jane Doe',exact:true})).toBeVisible()
 await expect(page.locator('.document-created')).toContainText('Nov 3, 2026 · 9:05 AM EST')
})
test('customer snapshot opens complete filtered document lists and retains original timestamps',async({page})=>{
 const invoices=Array.from({length:35},(_,n)=>({...reviewDocument(4100+n,n===0?'void':n===1?'draft':'sent'),created_at:new Date(Date.UTC(2026,10,3,14,n)).toISOString()}))
 const estimates=Array.from({length:35},(_,n)=>({...reviewDocument(4200+n,n===0?'expired':'sent'),created_at:new Date(Date.UTC(2026,10,3,14,n)).toISOString()}))
 await mockWorkspace(page,{customers:[reviewCustomer],invoices:[...invoices,{...reviewDocument(4199),customer_id:id(999)}],estimates:[...estimates,{...reviewDocument(4299),customer_id:id(999)}],businessProfile:{timezone:'America/New_York'}})
 await page.goto('/?view=customers&document='+CID)
 await expect(page.getByRole('heading',{name:'Jane Doe',exact:true})).toBeVisible()
 await expect(page.locator('.customer-balance')).toContainText('$3300.00')
 await expect(page.locator('.customer-document-history')).toHaveCount(0)
 for(const kind of ['invoices','estimates']){
  const link=page.getByRole('link',{name:`View ${kind} for Jane Doe`})
  await expect(link).toContainText('35')
  await link.click()
  await expect(page.getByLabel('Customer filter')).toContainText('Jane Doe')
  await expect(page.getByText('35 records · Page 1 of 2')).toBeVisible()
  await expect(page.locator('.module-record-list .document-row')).toHaveCount(25)
  await page.getByRole('button',{name:'Next',exact:true}).click()
  await expect(page.locator('.module-record-list .document-row')).toHaveCount(10)
  await page.getByRole('searchbox').fill(kind==='invoices'?'INV-4100':'EST-4200')
  await expect(page.locator('.module-record-list .document-row')).toHaveCount(1)
  await expect(page.locator('.module-record-list .document-created')).toContainText('Nov 3, 2026 · 9:00 AM EST')
  await page.locator('.module-record-list .document-row button').first().click()
  if(kind==='estimates')await page.getByRole('dialog',{name:'Estimate preview'}).getByRole('tab',{name:'Activity',exact:true}).click()
  await expect(page.getByRole('region',{name:'Document record'}).locator('time').first()).toHaveText('Nov 3, 2026 · 9:00 AM EST')
  await expect(page).toHaveURL(new RegExp('customer='+CID))
  if(kind==='invoices')await page.getByRole('link',{name:'Customer record: Jane Doe'}).click()
  else {await page.getByRole('button',{name:'Close preview',exact:true}).click();await expect(page).toHaveURL(new RegExp('customer='+CID));await page.getByRole('link',{name:'Back to customer',exact:true}).click()}
 }
 await page.screenshot({path:'test-results/customer-workspace-desktop.png',fullPage:true})
})

for (const width of [390, 1440]) test(`Needs Attention category buttons open filtered queues at ${width}px`, async ({page}) => {
  await page.setViewportSize({width, height:900})
  const state = await mockWorkspace(page, {
    workflow: {
      approved: Array.from({length:6}, (_, n) => ({id:id(5000+n), estimate_number:`APPROVED-${n}`, customer_name:'Jane Doe', offer:null})),
      completed: [{id:id(5010), title:'Finished lawn work', invoice_id:id(5011)}],
    },
    invoices: [{id:id(5012), invoice_number:'INV-LATE', status:'sent', due_date:'2000-01-01', balance_due:100, customers:customer}],
    reminders: [reminder(5013)],
  })
  await page.goto('/?view=dashboard')
  const hub = page.getByRole('article', {name:'Needs attention overview'})
  const categories = hub.getByRole('group', {name:'Needs Attention categories'})
  for (const [label, filter, item, count] of [
    ['Needs scheduling','schedule','APPROVED-0',6],
    ['Billing review','invoice','Finished lawn work',1],
    ['Overdue invoices','overdue','INV-LATE',1],
    ['Follow-ups due','follow_up','Call customer 5013',1],
  ]) {
    const button = categories.getByRole('button', {name:`${label} ${count}`, exact:true})
    if (filter === 'schedule') {
      await button.focus()
      await page.keyboard.press('Enter')
    } else await button.click()
    await expect(button).toHaveAttribute('aria-pressed','true')
    const queue = hub.getByRole('region', {name:label, exact:true})
    await expect(queue).toContainText(item)
    await expect(queue.getByRole('listitem')).toHaveCount(Math.min(5,count))
    expect(state.requests.some(request => request.body?.p_filter === filter && request.body?.p_page === 1)).toBe(true)
    if (filter === 'schedule') {
      await queue.getByRole('button', {name:'Next', exact:true}).click()
      await expect(queue).toContainText('APPROVED-5')
      await expect(queue.getByRole('listitem')).toHaveCount(1)
    }
  }
  state.reminders = []
  await page.evaluate(() => window.dispatchEvent(new Event('finviant-work-changed')))
  await expect(hub.getByText('No follow-ups are due.')).toBeVisible()
  await expect(categories.getByRole('button', {name:'Follow-ups due 0', exact:true})).toBeEnabled()
  await hub.getByRole('button', {name:/^Needs Attention \d/}).click()
  await expect(hub.getByRole('region', {name:'Needs Attention', exact:true}).getByText('Finished lawn work')).toBeVisible()
})

const receiptImage = {name:'receipt.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAFElEQVR4nGNkaGhgwAaYsIoOWgkAzIgBEFCQDcoAAAAASUVORK5CYII=','base64')}
async function selectReceipt(page, area, camera = false) {
  await expect(area.getByText('Take a photo or upload a receipt image',{exact:true})).toBeVisible()
  await area.getByRole('button',{name:'Scan receipt',exact:true}).click()
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    area.getByRole('button',{name:camera?'Take photo':'Upload image',exact:true}).click(),
  ])
  expect(await chooser.element().getAttribute('capture')).toBe(camera?'environment':null)
  await chooser.setFiles(receiptImage)
}
const finishedReviewJob = {
  id:id(190), title:'Finished deck repair', status:'completed', scheduled_start:null, customer_id:CID,
  customers:{...customer,email:'jane@example.test',phone:'+17575550100'}, properties:[],
}

test('Individual receipt scan fills an editable expense and a failed upload retries against the same expense', async ({page}) => {
  const state = await mockWorkspace(page, {plan:'basic',receiptUploadFailures:1,jobs:[finishedReviewJob]})
  await page.setViewportSize({width:390,height:844})
  await page.goto('/?view=dashboard')
  await page.getByRole('region',{name:'Financial Performance'}).getByRole('button',{name:'Add transaction',exact:true}).click()
  const chooser = page.getByRole('dialog',{name:'Add financial entry',exact:true})
  await selectReceipt(page, chooser)
  const expense = page.getByRole('dialog',{name:'Add Expense',exact:true})
  await expect(expense.getByLabel('Amount in USD')).toHaveValue('48.91')
  await expect(expense.getByLabel('Transaction date')).toHaveValue(receiptDay())
  await expect(expense.getByLabel('Description')).toHaveValue('Supply Store')
  await expect(expense.getByRole('img',{name:'Preview selected receipt'})).toBeVisible()
  await expense.getByText('Details read from the receipt',{exact:true}).click()
  await expect(expense.getByText('Treated wood')).toBeVisible()
  await expense.getByLabel('Amount in USD').fill('49.00')
  await expense.getByText('Link to a job (optional)',{exact:true}).click()
  await expense.getByRole('combobox',{name:'Job',exact:true}).selectOption(finishedReviewJob.id)
  await expense.getByRole('button',{name:'Save entry',exact:true}).click()
  await expect(expense.getByRole('alert')).toContainText('Expense saved')
  await expense.getByRole('button',{name:'Retry receipt upload'}).click()
  await expect(expense).toHaveCount(0)
  expect(state.expenses).toHaveLength(1)
  expect(state.expenses[0].amount).toBe(49)
  expect(state.expenses[0].job_id).toBe(finishedReviewJob.id)
  expect(state.uploadedReceipts.size).toBe(1)
  const saves=state.requests.filter(request=>request.path.endsWith('/rpc/save_receipt_expense'))
  expect(saves).toHaveLength(2)
  expect(saves[1].body).toEqual(saves[0].body)
  await page.locator('.performance-metric.expense').click()
  const row=page.locator('.transaction-list > li').filter({hasText:'Supply Store'})
  await row.getByText('View receipt',{exact:true}).click()
  await expect(row.getByRole('link',{name:'Open receipt image'})).toHaveAttribute('href',/finviant-record-photos/)
})

test('Business Pro can save a manual job expense with a receipt while Textract awaits activation', async ({page}) => {
  const state = await mockWorkspace(page, {plan:'pro',scanUnavailable:true,jobs:[finishedReviewJob],storageUsage:{warning:'critical',remaining_bytes:500_000_000}})
  await page.goto('/?view=work&document='+finishedReviewJob.id)
  const dialog=page.getByRole('dialog',{name:'Job details',exact:true})
  await dialog.getByRole('tab',{name:'Photos & expenses',exact:true}).click()
  const panel=dialog.getByRole('region',{name:'Photos and expenses'})
  await selectReceipt(page, panel, true)
  await expect(panel.getByRole('alert')).toContainText('awaiting setup')
  await expect(panel.getByRole('img',{name:'Preview selected receipt'})).toBeVisible()
  await expect(panel.getByRole('link',{name:'View storage',exact:true})).toHaveAttribute('href','/?view=settings&section=storage')
  await panel.getByLabel('Amount ($)').fill('20.50')
  await panel.getByLabel('Description',{exact:true}).fill('Deck screws')
  await panel.getByRole('button',{name:'Save expense',exact:true}).click()
  await expect(panel.getByText('Deck screws',{exact:true})).toBeVisible()
  expect(state.expenses).toHaveLength(1)
  expect(state.expenses[0].job_id).toBe(finishedReviewJob.id)
  expect(state.uploadedReceipts.size).toBe(1)
})

test('Google review setup and completed-job handoff use an official link and personal apps', async ({page}) => {
  const link='https://g.page/r/TestOffice123/review'
  const state=await mockWorkspace(page, {plan:'basic',businessProfile:{google_review_url:link},jobs:[finishedReviewJob]})
  await page.goto('/?view=settings&section=company')
  await expect(page.getByLabel('Google review link')).toHaveValue(link)
  await page.getByLabel('Google review link').fill('https://g.page.evil.example/r/Test/review')
  await page.getByRole('button',{name:'Save company profile'}).click()
  await expect(page.getByText(/Paste the review link copied from Google Business Profile/)).toBeVisible()
  await page.getByLabel('Google review link').fill(link+'?source=share')
  await page.getByRole('button',{name:'Save company profile'}).click()
  await expect.poll(()=>state.requests.find(r=>r.path.endsWith('/businesses')&&r.method==='PATCH')?.body.google_review_url).toBe(link)
  await page.goto('/?view=work&document='+finishedReviewJob.id)
  await page.getByRole('dialog',{name:'Job details',exact:true}).getByRole('region',{name:'Record actions',exact:true}).locator('summary').click()
  await page.getByRole('button',{name:'Request a Google review'}).click()
  const review=page.getByRole('region',{name:'Google review request'})
  await expect(review.getByLabel('Review request message')).toHaveValue(/Hi Jane.*share your experience/s)
  await expect(review.getByRole('link',{name:'Open email'})).toHaveAttribute('href', /^mailto:jane%40example\.test\?/)
  await expect(review.getByRole('link',{name:'Open text'})).toHaveAttribute('href', /^sms:\+17575550100/)
  expect(state.requests.some(r=>r.path.includes('/functions/v1/send'))).toBe(false)
})

test('Free displays upgrade links for receipt scanning and Google reviews and still opens manual expense entry', async ({page}) => {
  await mockWorkspace(page,{plan:'free',businessProfile:{google_review_url:'https://g.page/r/Test/review'},jobs:[finishedReviewJob]})
  await page.goto('/?view=work&document='+finishedReviewJob.id)
  const dialog=page.getByRole('dialog',{name:'Job details',exact:true})
  await dialog.getByRole('region',{name:'Record actions',exact:true}).locator('summary').click()
  await expect(dialog.getByText('Requesting Google reviews is unavailable on the Free plan.')).toBeVisible()
  await expect(dialog.getByRole('button',{name:'Request a Google review'})).toHaveCount(0)
  await dialog.getByRole('tab',{name:'Photos & expenses',exact:true}).click()
  const panel=dialog.getByRole('region',{name:'Photos and expenses'})
  await panel.getByRole('button',{name:'Add expense manually',exact:true}).click()
  await expect(panel.getByText('Receipt scanning is unavailable on the Free plan.')).toBeVisible()
  await expect(panel.getByRole('link',{name:'Explore Individual',exact:true})).toHaveAttribute('href','/?view=settings&section=plans&tier=basic')
  await expect(panel.getByRole('button',{name:'Scan receipt',exact:true})).toHaveCount(0)
  await expect(panel.getByLabel('Amount ($)')).toBeEditable()
})

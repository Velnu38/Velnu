import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile,readdir } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { fixture,ids,actor } from './fixture.js'
import { parseContactCards,normalizePhoneContact } from '../../src/lib/contactImport.js'
const baseline=await readFile('supabase/migrations/20261028173902_finviant_complete_application_bootstrap.sql','utf8')
const owner=await readFile('supabase/migrations/20261102170333_owner_team_document_settings.sql','utf8')
const workflowFiles=(await readdir('supabase/migrations')).filter(name=>name.endsWith('_document_workflow_and_contact_import.sql'));assert.equal(workflowFiles.length,1)
const workflow=await readFile('supabase/migrations/'+workflowFiles[0],'utf8')
function fn(text:string,name:string){const a=text.indexOf('CREATE OR REPLACE FUNCTION '+name+'(');assert.ok(a>=0,'Function '+name+' exists');return text.slice(a,text.indexOf('$function$;',a)+12)}
async function setup(){const db=await fixture();await db.exec('reset role;');
  for(const table of ['change_order_items']){const match=baseline.match(new RegExp('create table "public"\\."'+table+'" \\(([\\s\\S]*?)\\);','i'))!;await db.exec('create table public.'+table+' ('+match[1]+');alter table '+table+' add primary key(id);')}
  await db.exec(fn(baseline,'private.valid_payment_links'))
  const a=owner.indexOf('create function private.guard_invoice_destinations('),b=owner.indexOf('end $$;',a)+7
  await db.exec(owner.slice(a,b))
  await db.exec(`create function private.is_primary_owner(b uuid,actor uuid default auth.uid()) returns boolean language sql stable security definer as $$select b='${ids.business}'::uuid and actor='${ids.owner}'::uuid$$;
    grant select,insert,update,delete on change_orders,change_order_items to authenticated;`)
  await db.exec(fn(baseline,'public.recalc_change_order'))
  await db.exec(fn(baseline,'private.commerce_change_item_guard'))
  await db.exec('create trigger change_item_guard before insert or update or delete on change_order_items for each row execute function private.commerce_change_item_guard();create trigger change_items_recalc after insert or update or delete on change_order_items for each row execute function public.recalc_change_order();')
  await db.exec(workflow)
  await db.exec('set role authenticated;');return db
}
const items=[{description:'Original work',quantity:1,unit_price:100,tax_rate:5}]
async function document(db:any,kind='estimate',extra={}){return (await db.query('select create_document($1,$2,$3,$4) r',[ids.business,kind,randomUUID(),{customer_id:ids.customer,items,...extra}])).rows[0].r}
const change={title:'Extra work',description:'Add one item',items:[{description:'Only the addition',quantity:1,unit_price:20,tax_rate:0}]}
test('change orders inherit an unscheduled draft document, clamp forged references and safely retry',async()=>{
 const db=await setup();try{for(const kind of ['estimate','invoice']){const d=await document(db,kind),request=randomUUID();const context=(await db.query('select get_document_change_context($1,$2) r',[kind,d.id])).rows[0].r as any;assert.equal(context.can_change,true);assert.equal(context.customer_id,ids.customer);assert.equal(context.job_id,null);assert.equal(context.items[0].description,'Original work');
 const input={...change,customer_id:ids.outsider,job_id:randomUUID(),estimate_id:randomUUID()};const saved=(await db.query('select create_document_change_order($1,$2,$3,$4) r',[kind,d.id,request,input])).rows[0].r as any;
 assert.equal(Number(saved.total),20);assert.equal(saved.customer_id,ids.customer);assert.equal(saved.job_id,null);assert.equal(kind==='invoice'?saved.source_invoice_id:saved.estimate_id,d.id);
 await db.query('select create_document_change_order($1,$2,$3,$4)',[kind,d.id,request,input]);
 await assert.rejects(()=>db.query('select create_document_change_order($1,$2,$3,$4)',[kind,d.id,request,{...input,title:'Changed retry'}]),/different content/)
 }assert.equal((await db.query('select count(*)::int n from change_orders')).rows[0].n,2)
 }finally{await db.close()}
})
test('completed work, cross-business sources and technician changes are rejected',async()=>{
 const db=await setup();try{const d=await document(db),job=randomUUID();await db.query("insert into jobs(id,business_id,customer_id,title,status) values($1,$2,$3,'Finished','completed')",[job,ids.business,ids.customer]);await db.query('update estimates set job_id=$1 where id=$2',[job,d.id]);assert.equal(((await db.query('select get_document_change_context($1,$2) r',['estimate',d.id])).rows[0].r as any).can_change,false);
 await assert.rejects(()=>db.query('select create_document_change_order($1,$2,$3,$4)',['estimate',d.id,randomUUID(),change]),/complete/);
 await actor(db,ids.worker);await assert.rejects(()=>db.query('select get_document_change_context($1,$2)',['estimate',d.id]),/access/);await actor(db,ids.outsider);await assert.rejects(()=>db.query('select get_document_change_context($1,$2)',['estimate',d.id]),/access/)
 }finally{await db.close()}
})
test('a manually entered customer and payment choices save atomically with the new document',async()=>{
 const db=await setup();try{const id=randomUUID(),request=randomUUID(),customer={first_name:'Typed',last_name:'Customer',email:'typed@example.test',phone:'555-0100'},links=[{provider:'stripe',url:'https://buy.stripe.com/test-link'}];const payload={customer_id:id,new_customer:customer,payment_links:links,payment_instructions:'Include invoice number',items};
 const saved=(await db.query('select create_document($1,$2,$3,$4) r',[ids.business,'estimate',request,payload])).rows[0].r as any;assert.equal(saved.customer_id,id);assert.deepEqual(saved.payment_links,links);await db.query('select create_document($1,$2,$3,$4)',[ids.business,'estimate',request,payload]);assert.equal((await db.query('select count(*)::int n from customers where id=$1',[id])).rows[0].n,1);
 const bad=randomUUID();await assert.rejects(()=>db.query('select create_document($1,$2,$3,$4)',[ids.business,'invoice',randomUUID(),{...payload,customer_id:bad,items:[{...items[0],quantity:-1}]}]));assert.equal((await db.query('select count(*)::int n from customers where id=$1',[bad])).rows[0].n,0)
 }finally{await db.close()}
})
test('issued quote payment choices stay frozen and conversion retains them',async()=>{
 const db=await setup();try{const links=[{provider:'paypal',url:'https://paypal.me/examplebusiness'}],d=await document(db,'estimate',{payment_links:links,payment_instructions:'Reference the quote'});await db.query("update estimates set status='accepted' where id=$1",[d.id]);await assert.rejects(()=>db.query("update estimates set payment_instructions='different' where id=$1",[d.id]),/locked/);
 const invoice=(await db.query('select convert_estimate_to_invoice($1) id',[d.id])).rows[0].id;assert.deepEqual((await db.query('select payment_links from invoices where id=$1',[invoice])).rows[0].payment_links,links)
 }finally{await db.close()}
})
test('completion retains the quoted payment destination and office conversion cannot invent a destination',async()=>{
 const db=await setup();try{const links=[{provider:'stripe',url:'https://buy.stripe.com/quoted-link'}],d=await document(db,'estimate',{payment_links:links,payment_instructions:'Quoted instructions'});await db.query("update estimates set status='accepted' where id=$1",[d.id]);const slots=(await db.query('select suggest_scheduling_slots($1,$2,$3,$4) r',[ids.business,[ids.owner],60,new Date(Date.now()+14*86400000).toISOString().slice(0,10)])).rows[0].r as any[];const booked=(await db.query('select book_approved_estimate($1,$2) r',[d.id,{title:'Quoted visit',property_id:ids.site,workers:[ids.owner],...slots[0]}])).rows[0].r as any;
 await db.exec("reset role;select set_config('request.jwt.claim.sub','',false);set role service_role;");const done=(await db.query('select complete_job_workflow($1,$2) r',[booked.job_id,ids.owner])).rows[0].r as any;assert.equal(done.invoice_ready,true);await db.exec('reset role');const invoice=(await db.query('select payment_links,payment_instructions from invoices where id=$1',[done.invoice_id])).rows[0];assert.deepEqual(invoice.payment_links,links);assert.equal(invoice.payment_instructions,'Quoted instructions')
 }finally{await db.close()}
})
test('only the primary owner imports contacts; duplicate and uncertain requests never overwrite customers',async()=>{
 const db=await setup();try{const c={id:randomUUID(),first_name:'Contact',last_name:'Owner',email:'phone@example.test',phone:'(757) 555-0101'};let r=(await db.query('select import_customer_contacts($1,$2) r',[ids.business,[c]])).rows[0].r as any;assert.equal(r.imported,1);r=(await db.query('select import_customer_contacts($1,$2) r',[ids.business,[c]])).rows[0].r as any;assert.equal(r.already_imported,1);
 r=(await db.query('select import_customer_contacts($1,$2) r',[ids.business,[{...c,id:randomUUID(),email:'PHONE@example.test'}]])).rows[0].r as any;assert.equal(r.skipped,1);
 await assert.rejects(()=>db.query('select import_customer_contacts($1,$2)',[ids.business,[{...c,first_name:'Changed'}]]),/different details/);await actor(db,ids.worker);await assert.rejects(()=>db.query('select import_customer_contacts($1,$2)',[ids.business,[c]]),/primary/);await actor(db,ids.outsider);await assert.rejects(()=>db.query('select import_customer_contacts($1,$2)',[ids.business,[c]]),/primary/)
 }finally{await db.close()}
})
test('a bad import batch rolls back its contacts and rejects oversized/invalid inputs',async()=>{
 const db=await setup();try{const c={id:randomUUID(),first_name:'Valid',last_name:null,email:null,phone:null};await assert.rejects(()=>db.query('select import_customer_contacts($1,$2)',[ids.business,[c,{...c,id:randomUUID(),first_name:''}]]));assert.equal((await db.query('select count(*)::int n from customers where id=$1',[c.id])).rows[0].n,0);await assert.rejects(()=>db.query('select import_customer_contacts($1,$2)',[ids.business,Array.from({length:101},()=>c)]),/100/)}finally{await db.close()}
})
test('vCard import reads iPhone/Google names, folded UTF-8, escaped text and only contact fields',()=>{
 const text='BEGIN:VCARD\r\nVERSION:3.0\r\nN:Smith;Jane;;;\r\nFN:Jane Smith\r\nEMAIL;TYPE=HOME:jane@example.test\r\nTEL;TYPE=CELL:7575550101\r\nNOTE:Never import this private note\r\nPHOTO:ignored\r\nEND:VCARD\r\nBEGIN:VCARD\r\nVERSION:4.0\r\nFN:Renée Long\r\n  Name\\, Jr.\r\nTEL;VALUE=uri:tel:+17575550102\r\nEND:VCARD';const result=parseContactCards(text,randomUUID);assert.equal(result.contacts.length,2);assert.equal(result.contacts[1].first_name,'Renée');assert.equal(result.contacts[1].phone,'+17575550102');assert.equal('notes' in result.contacts[0],false)
})
test('contact preview deduplicates cards and handles invalid or oversized exports',()=>{
 const card='BEGIN:VCARD\nVERSION:3.0\nFN:Test Person\nEMAIL:test@example.test\nEND:VCARD';const parsed=parseContactCards(card+'\n'+card,randomUUID);assert.equal(parsed.contacts.length,1);assert.equal(parsed.ignored,1);assert.throws(()=>parseContactCards('<script>alert(1)</script>',randomUUID),/No contacts/);assert.throws(()=>parseContactCards('x'.repeat(8*1024*1024+1),randomUUID),/8 MB/);assert.equal(normalizePhoneContact({email:['no-name@example.test']},randomUUID()),null)
})

test('contact cards with photo padding remain readable and malformed nested cards fail promptly',()=>{
 const card='BEGIN:VCARD\nVERSION:3.0\nFN:Photo Contact\nPHOTO;ENCODING=b:YWJjZA==\nEND:VCARD';assert.equal(parseContactCards(card,randomUUID).contacts[0].first_name,'Photo')
 assert.throws(()=>parseContactCards('BEGIN:VCARD\n'.repeat(10000),randomUUID),/incomplete/)
 const qp='BEGIN:VCARD\nVERSION:2.1\nFN;ENCODING=QUOTED-PRINTABLE:Ren=C3=A9e=\n Smith\nEND:VCARD';assert.equal(parseContactCards(qp,randomUUID).contacts[0].first_name,'Renée')
})

test('documents keep server creation time, and issued records retain their customer and backdated issue date',async()=>{
 const db=await setup();try{
  for(const kind of ['invoice','estimate']){
   const before=Date.now(),d=await document(db,kind,{issue_date:'2026-01-15',created_at:'2000-01-01T00:00:00Z',updated_at:'2000-01-01T00:00:00Z'})
   const table=kind==='invoice'?'invoices':'estimates'
   const saved=(await db.query(`select customer_id,created_at,updated_at,issue_date from ${table} where id=$1`,[d.id])).rows[0] as any
   assert.equal(saved.customer_id,ids.customer);assert.equal(new Date(saved.issue_date).toISOString().slice(0,10),'2026-01-15');assert.ok(new Date(saved.created_at).getTime()>=before-1000)
   assert.ok(new Date(saved.created_at).getTime()<=Date.now()+1000)
   await assert.rejects(db.query(`update ${table} set created_at='2000-01-01' where id=$1`,[d.id]),/creation date cannot change/)
   await db.query(`update ${table} set status='sent' where id=$1`,[d.id])
   await assert.rejects(db.query(`update ${table} set customer_id=$2 where id=$1`,[d.id,ids.outsider]),/ownership|customer/i)
   await db.query(`update ${table} set status=$2 where id=$1`,[d.id,kind==='invoice'?'void':'expired'])
   const retained=(await db.query(`select created_at,customer_id from ${table} where id=$1`,[d.id])).rows[0]
   assert.deepEqual(retained,{created_at:saved.created_at,customer_id:ids.customer})
  }
 }finally{await db.close()}
})

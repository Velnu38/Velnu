import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'
import { generateDocumentPdf } from '../../shared/documentPdf.ts'

const B='11111111-1111-4111-8111-111111111111', D='22222222-2222-4222-8222-222222222222'
const A='33333333-3333-4333-8333-333333333333', C='44444444-4444-4444-8444-444444444444'
const TOKEN='ab'.repeat(32), APPROVAL='cd'.repeat(32)
const canonical=await readFile('supabase/migrations/20261108001428_canonical_customer_document_revisions.sql','utf8')
const privacy=await readFile('supabase/migrations/20261108003822_legacy_document_snapshot_privacy.sql','utf8')
const original={kind:'invoice',number:'INV-ORIGINAL',status:'sent',amount_paid:0,balance_due:100,issue_date:'2026-11-01',subtotal:100,tax_amount:0,total:100,
  items:[{description:'ORIGINAL_SCOPE',quantity:1,unit_price:100,line_total:100}],
  customer:{name:'Original Customer',email:'original@example.test',phone:'+17575550111'},company:{name:'Original Issuer'}}
function definition(name:string) {
  const fn=canonical.indexOf('function '+name+'(')
  assert.ok(fn>=0)
  const start=canonical.lastIndexOf('create',fn)
  return canonical.slice(start,canonical.indexOf('end $$;',start)+'end $$;'.length)
}
async function setup() {
  const db=new PGlite()
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema private;
    grant usage on schema private to anon,authenticated,service_role;
    create table public.customers(id uuid primary key,name text,address text,notes text);
    create table public.invoices(id uuid primary key,business_id uuid,customer_id uuid,description text,private_note text,
      status text default 'sent',amount_paid numeric default 0,balance_due numeric default 100,total numeric default 100);
    create table private.document_versions(id uuid primary key,business_id uuid,kind text,document_id uuid,revision_number integer,
      snapshot jsonb,snapshot_hash text,created_at timestamptz,action_expires_at timestamptz,superseded_at timestamptz);
    create unique index current_version on private.document_versions(business_id,kind,document_id) where superseded_at is null;
    create table private.document_shares(token_hash text primary key,business_id uuid,kind text,document_id uuid,
      snapshot jsonb,created_at timestamptz default now(),expires_at timestamptz default now()+interval '14 days',
      revoked_at timestamptz,revision_id uuid,legacy_pdf_version_id uuid,approval_token text,approval_ready_at timestamptz);
    create table public.document_approval_links(id uuid primary key default gen_random_uuid(),token_hash text,business_id uuid,
      document_type text,estimate_id uuid,change_order_id uuid,created_at timestamptz default now(),expires_at timestamptz default now()+interval '14 days',
      revoked_at timestamptz,document_version_id uuid,legacy_pdf_version_id uuid,legacy_entitlement boolean default true);
    create table public.document_approvals(id uuid default gen_random_uuid(),approval_link_id uuid,document_snapshot jsonb,
      action text,typed_name text,amount_at_action numeric,created_at timestamptz default now());
    create function private.effective_plan(uuid) returns text language sql as $$select 'pro'::text$$;
    create function private.document_version_body(jsonb) returns jsonb language sql as $$select $1 - array['revision_id','revision_number','revision_created_at','status','amount_paid','balance_due','finviant_branding']$$;
    create function private.customer_document_snapshot(b uuid,k text,d uuid) returns jsonb language sql as $$
      select jsonb_build_object('kind',k,'description',i.description,'service_address',c.address,
        'status',i.status,'amount_paid',i.amount_paid,'balance_due',i.balance_due,'total',i.total,
        'customer',jsonb_build_object('id',c.id,'first_name',c.name,'address_line1',c.address),
        'company',jsonb_build_object('name','CURRENT_COMPANY_SECRET_CONTEXT'))
      from public.invoices i join public.customers c on c.id=i.customer_id where i.id=d $$;
    insert into public.customers values('${A}','Original Customer','ORIGINAL_ADDRESS_NEVER_STORED','ORIGINAL_PRIVATE_NOTE'),
      ('${C}','NEW_CUSTOMER_PRIVATE_NAME','NEW_CUSTOMER_PRIVATE_ADDRESS','NEW_CUSTOMER_PRIVATE_NOTE');
    insert into public.invoices(id,business_id,customer_id,description,private_note)
      values('${D}','${B}','${A}','ORIGINAL_LIVE_DESCRIPTION','ORIGINAL_INVOICE_PRIVATE_NOTE');`)
  await db.exec(definition('private.freeze_legacy_document_version'))
  await db.exec(definition('public.get_document_pdf_version'))
  await db.exec(definition('private.document_share_context'))
  await db.exec(definition('public.get_shared_document'))
  await db.exec('grant execute on function public.get_shared_document(text) to anon')
  await db.query(`insert into private.document_shares(token_hash,business_id,kind,document_id,snapshot)
    values(encode(sha256(convert_to($1,'UTF8')),'hex'),$2,'invoice',$3,$4)`,[TOKEN,B,D,original])
  return db
}
async function pdf(db:PGlite, token=TOKEN,type='document_share') {
  return (await db.query<{v:any}>('select public.get_document_pdf_version($1,$2) v',[token,type])).rows[0].v
}
async function anonymous(db:PGlite) {await db.exec('set role anon')}

test('historical share PDF cannot acquire another customer or current scope, including previously cached legacy artifacts',async()=>{
  const db=await setup()
  try {
    await db.exec(`update public.invoices set customer_id='${C}',description='NEW_CURRENT_SCOPE',private_note='NEW_INVOICE_PRIVATE_NOTE' where id='${D}'`)
    const unsafe=await pdf(db)
    assert.match(JSON.stringify(unsafe.snapshot),/NEW_CUSTOMER_PRIVATE_ADDRESS/,'reproduces the old enrichment bug')
    await db.exec(privacy)
    await anonymous(db)
    const safe=await pdf(db),again=await pdf(db)
    assert.notEqual(safe.version_id,unsafe.version_id,'invalidates any already cached unsafe legacy mapping')
    assert.equal(again.version_id,safe.version_id,'safe historical PDF binding remains stable')
    assert.deepEqual(safe.snapshot.customer,original.customer)
    assert.deepEqual(safe.snapshot.company,original.company)
    assert.deepEqual(safe.snapshot.items,original.items)
    assert.equal(safe.snapshot.service_address,undefined)
    assert.equal(safe.snapshot.description,undefined)
    assert.doesNotMatch(JSON.stringify(safe),/NEW_|CURRENT_|PRIVATE_NOTE|ORIGINAL_ADDRESS_NEVER_STORED/)
    const bytes=await generateDocumentPdf(safe.snapshot)
    assert.equal(new TextDecoder().decode(bytes.subarray(0,5)),'%PDF-')
    await assert.rejects(db.query('select * from private.document_versions'),/permission denied/)
    await assert.rejects(db.query("select private.freeze_legacy_document_version($1,'invoice',$2,$3,now(),null)",[B,D,original]),/permission denied/)
  } finally {await db.close()}
})

test('completed legacy receipt uses only recorded scope with unknown identities blank; pending unrecorded links fail closed',async()=>{
  const db=await setup()
  try {
    await db.query(`insert into public.document_approval_links(token_hash,business_id,document_type,estimate_id)
      values(encode(sha256(convert_to($1,'UTF8')),'hex'),$2,'estimate',$3)`,[APPROVAL,B,D])
    await db.exec(privacy)
    await anonymous(db)
    await assert.rejects(pdf(db,APPROVAL,'approval'),/LEGACY_DOCUMENT_SNAPSHOT_UNAVAILABLE/)
    await db.exec('reset role')
    const {customer,company,...scope}=original
    await db.query(`insert into public.document_approvals(approval_link_id,document_snapshot)
      select id,$1 from public.document_approval_links where document_type='estimate'`,[{...scope,document_type:'estimate',kind:undefined}])
    await db.exec(`update public.invoices set customer_id='${C}',description='NEW_CURRENT_SCOPE' where id='${D}'`)
    await anonymous(db)
    const receipt=await pdf(db,APPROVAL,'approval')
    assert.equal(receipt.snapshot.kind,'estimate')
    assert.deepEqual(receipt.snapshot.customer,{})
    assert.deepEqual(receipt.snapshot.company,{})
    assert.deepEqual(receipt.snapshot.items,original.items)
    assert.doesNotMatch(JSON.stringify(receipt),/NEW_|CURRENT_|PRIVATE_NOTE/)
    const bytes=await generateDocumentPdf(receipt.snapshot)
    assert.equal(new TextDecoder().decode(bytes.subarray(0,5)),'%PDF-')
  } finally {await db.close()}
})

test('pending legacy approval may use its original stored share, and canonical bound revisions remain unchanged',async()=>{
  const db=await setup()
  try {
    await db.query(`insert into public.document_approval_links(token_hash,business_id,document_type,estimate_id)
      values(encode(sha256(convert_to($1,'UTF8')),'hex'),$2,'estimate',$3)`,[APPROVAL,B,D])
    await db.query(`update private.document_shares set kind='estimate',approval_token=$1,snapshot=jsonb_set(snapshot,'{kind}','"estimate"')`,[APPROVAL])
    await db.query(`insert into private.document_versions(id,business_id,kind,document_id,revision_number,snapshot,snapshot_hash,created_at)
      values(gen_random_uuid(),$1,'invoice',$2,1,$3,repeat('a',64),now())`,[B,D,original])
    await db.exec(privacy)
    await anonymous(db)
    const approval=await pdf(db,APPROVAL,'approval')
    assert.deepEqual(approval.snapshot.customer,original.customer)
    assert.equal(approval.snapshot.kind,'estimate')
    await db.exec('reset role')
    await db.exec(`update private.document_shares set kind='invoice',revision_id=(select id from private.document_versions where kind='invoice'),legacy_pdf_version_id=null`)
    const canonicalPdf=await pdf(db)
    assert.deepEqual(canonicalPdf.snapshot,original,'privacy repair never changes an issued canonical binding or snapshot')
  } finally {await db.close()}
})

test('legacy and superseded customer URLs cannot reveal reassigned customer balances; current canonical payment progress still updates',async()=>{
  const db=await setup()
  try {
    const before=(await db.query<{oid:number}>("select 'private.document_share_context(text)'::regprocedure::oid oid")).rows[0].oid
    await db.exec(privacy)
    assert.equal((await db.query<{oid:number}>("select 'private.document_share_context(text)'::regprocedure::oid oid")).rows[0].oid,before,'existing RPC dependencies retain the privacy-gated function identity')
    await db.exec(`update public.invoices set customer_id='${C}',total=999,amount_paid=400,balance_due=599,status='partial' where id='${D}'`)
    await anonymous(db)
    const historical=(await db.query<{v:any}>('select public.get_shared_document($1) v',[TOKEN])).rows[0].v
    assert.equal(historical.live_amount_paid,0)
    assert.equal(historical.live_balance_due,100)
    assert.equal(historical.live_status,'sent')
    assert.equal(historical.action_state,'read_only')
    await db.exec('reset role')
    await db.exec(`update public.invoices set customer_id='${A}',total=100,amount_paid=0,balance_due=100,status='sent' where id='${D}'`)
    const version=(await db.query<{id:string}>(`insert into private.document_versions(id,business_id,kind,document_id,revision_number,snapshot,snapshot_hash,created_at)
      select gen_random_uuid(),$1,'invoice',$2,1,s,encode(sha256(convert_to(private.document_version_body(s)::text,'UTF8')),'hex'),now()
      from (select private.customer_document_snapshot($1,'invoice',$2) s) source returning id`,[B,D])).rows[0].id
    await db.query('update private.document_shares set revision_id=$1',[version])
    await db.exec(`update public.invoices set amount_paid=25,balance_due=75,status='partial' where id='${D}'`)
    await anonymous(db)
    const current=(await db.query<{v:any}>('select public.get_shared_document($1) v',[TOKEN])).rows[0].v
    assert.equal(current.live_amount_paid,25)
    assert.equal(current.live_balance_due,75)
    assert.equal(current.live_status,'partial')
    await db.exec('reset role')
    await db.exec(`update public.invoices set customer_id='${C}',total=999,amount_paid=400,balance_due=599,status='paid' where id='${D}'`)
    await anonymous(db)
    const changed=(await db.query<{v:any}>('select public.get_shared_document($1) v',[TOKEN])).rows[0].v
    assert.equal(changed.live_amount_paid,0)
    assert.equal(changed.live_balance_due,100)
    assert.equal(changed.live_status,'sent')
    assert.equal(changed.action_state,'superseded')
    assert.doesNotMatch(JSON.stringify(changed),/NEW_CUSTOMER|999|599/)
  } finally {await db.close()}
})

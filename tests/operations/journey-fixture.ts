import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {managementFixture} from './management-fixture.ts'
export {B,C,I,J,O,U,W,invoice,user,value} from './management-fixture.ts'
function block(sql:string,marker:string,end='end $$;'){
  const a=sql.indexOf(marker),b=sql.indexOf(end,a)
  assert.ok(a>=0&&b>a,marker)
  return sql.slice(a,b+end.length)
}
export async function journeyFixture(notices=false){
 const db=await managementFixture()
 try{
  await db.exec('reset role')
  const square=await readFile('supabase/migrations/20261109165731_square_payment_workflow.sql','utf8')
  await db.exec(block(square,'create table private.square_invoice_operations(',');'))
  await db.exec(`alter table public.customers add column if not exists archived boolean default false;
    create function public.claim_document_email(p_request uuid,p_pdf_capable boolean) returns jsonb language sql security definer as $$select public.claim_document_email(p_request)$$;`)
  await db.exec(await readFile('supabase/migrations/20261109222000_invoice_reminder_overrides.sql','utf8'))
  // Use the real revision/capability validators. The prior fixture's payment context
  // deliberately models a different boundary and must not stand in for public shares.
  const versions=await readFile('supabase/migrations/20261108001428_canonical_customer_document_revisions.sql','utf8')
  await db.exec(versions.slice(0,versions.indexOf('alter function private.customer_document_snapshot')))
  await db.exec('alter table private.document_shares add column if not exists approval_ready_at timestamptz;drop function private.document_share_context(text);')
  for(const[name,end]of [['private.document_action_deadline','end $$;'],['private.document_version_body','$$;'],['private.publish_document_version','end $$;'],['private.create_document_share','end $$;'],['private.document_share_context','end $$;']])await db.exec(block(versions,'create function '+name+'(',end))
  await db.exec(block(versions,'create or replace function public.get_shared_document('))
  await db.exec(`create function private.owner_archive_sources(b uuid,owner_id uuid) returns table(collection text,payload jsonb) language sql as $$select null::text,null::jsonb where false$$;`)
  await db.exec(await readFile('supabase/migrations/20261114000100_supported_journey_framework.sql','utf8'))
  if(notices){
   const pro=await readFile('supabase/migrations/20261108155833_pro_value_workflow_release.sql','utf8')
   await db.exec(block(pro,'create or replace function private.manual_or_pro_email(', '$$;'))
   await db.exec(block(pro,'CREATE OR REPLACE FUNCTION private.claim_document_email_before_pdf(', '$function$\n;'))
   await db.exec(`create or replace function private.claim_document_email_before_invoice_preferences(p_request uuid,p_pdf_capable boolean) returns jsonb language sql security definer as $$select private.claim_document_email_before_pdf(p_request)$$;`)
   await db.exec(await readFile('supabase/migrations/20261114000200_journey_customer_notices.sql','utf8'))
  }
  return db
 }catch(error){await db.close();throw error}
}

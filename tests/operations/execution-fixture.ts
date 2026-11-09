import { readFile } from "node:fs/promises";
import { fixture, ids, actor } from "../scheduling/fixture.ts";
export { ids, actor };
export async function executionFixture(billing = false) {
  const db = await fixture(true);
  try {
    await db.exec(`reset role;
 alter table auth.users add column raw_user_meta_data jsonb default '{}';

 alter table public.change_orders add column change_totals jsonb,add column source_invoice_id uuid;
 create function private.velnu_has_accepted_terms() returns boolean language sql stable as $$select auth.uid() is not null$$;
 create function private.is_business_member(target_business_id uuid) returns boolean language sql stable security definer as $$select exists(select 1 from public.business_members where business_id=target_business_id and user_id=auth.uid())$$;
 drop function private.has_business_role(uuid,text[]);drop function private.can_write_business(uuid);
 create function private.has_business_role(target_business_id uuid,allowed_roles text[]) returns boolean language sql stable security definer as $$select exists(select 1 from public.business_members where business_id=target_business_id and user_id=auth.uid() and role=any(allowed_roles))$$;
 create function private.can_write_business(target_business_id uuid) returns boolean language sql stable security definer as $$select private.has_business_role(target_business_id,array['owner','admin','office','technician'])$$;
 create function private.change_order_billing_state(c public.change_orders) returns jsonb language sql as $$select jsonb_build_object('action','awaiting_approval')$$;
 create table public.business_activity(business_id uuid primary key,version integer not null default 1,updated_at timestamptz default now());
 create table public.bookkeeping_entries(id uuid primary key default gen_random_uuid(),business_id uuid,created_by uuid,entry_date date,direction text,amount numeric,currency text default 'USD',category text,description text,job_id uuid,invoice_id uuid,estimate_id uuid);
 grant usage on schema private,auth to service_role;
 create schema storage;create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb);create table storage.buckets(id text,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 grant usage on schema storage to authenticated;grant all on storage.objects to authenticated;
 create function private.require_record_module(b uuid,m text,writing boolean default false) returns void language plpgsql security definer as $$begin if private.member_module_access(b,auth.uid(),m) is not true then raise exception 'Access required' using errcode='42501';end if;end$$;
 `);
    await db.exec(
      billing
        ? await billingSetup(db)
        : `alter table public.invoices add column deposit_estimate_id uuid;`,
    );
    await db.exec(
      await readFile(
        "supabase/migrations/20261108131228_team_management_workers.sql",
        "utf8",
      ),
    );
    await db.exec(
      await readFile(
        "supabase/migrations/20261109165725_financial_job_workspace.sql",
        "utf8",
      ),
    );
    await db.exec(
      (
        await readFile(
          "supabase/migrations/20261102152958_record_photos_expenses.sql",
          "utf8",
        )
      ).split("-- Use the existing ledger")[0],
    );
    await db.exec(
      `alter table public.record_photos add column expense_id uuid;create policy owner_module_access on public.record_photos as restrictive for all to authenticated using(private.member_module_access(business_id,auth.uid(),'jobs'));`,
    );
    await db.exec(
      (
        await readFile(
          "supabase/migrations/20261106141538_business_storage_limits.sql",
          "utf8",
        )
      )
        .replace(
          "drop constraint business_entitlements_plan_check",
          "drop constraint if exists business_entitlements_plan_check",
        )
        .split("-- Publish the revised agreement")[0],
    );
    await db.exec(
      await readFile(
        "supabase/migrations/20261109184128_job_management_workspace.sql",
        "utf8",
      ),
    );
    await db.exec(
      "alter table public.appointments drop constraint appointments_id_business_id_key",
    );
    const lifecycle = await readFile(
      "supabase/migrations/20261108011707_record_action_consistency.sql",
      "utf8",
    );
    const lifecycleStart = lifecycle.indexOf(
      "create function private.guard_linked_appointment_lifecycle",
    );
    const lifecycleEnd = lifecycle.indexOf(
      "create function public.update_appointment_workflow",
      lifecycleStart,
    );
    await db.exec(lifecycle.slice(lifecycleStart, lifecycleEnd));
    for (const path of [
      "20261109203232_planned_job_visits.sql",
      "20261109203235_assigned_field_workspace.sql",
      "20261109203238_job_cost_review_completion_reports.sql",
    ])
      await db.exec(await readFile("supabase/migrations/" + path, "utf8"));
    await db.exec(`alter table public.jobs enable row level security;create policy jobs_read on public.jobs for select to authenticated using(private.is_business_member(business_id));create policy jobs_write on public.jobs for update to authenticated using(private.can_write_business(business_id));create policy jobs_module on public.jobs as restrictive for all to authenticated using(private.member_module_access(business_id,auth.uid(),'jobs'));
 alter table public.customers enable row level security;create policy customers_read on public.customers for select to authenticated using(private.is_business_member(business_id));
 alter table public.business_members enable row level security;create policy members_read on public.business_members for select to authenticated using(private.is_business_member(business_id));
 alter table public.businesses enable row level security;create policy businesses_read on public.businesses for select to authenticated using(private.is_business_member(id));
 alter table storage.objects enable row level security;set role authenticated;`);
    return db;
  } catch (e) {
    await db.close();
    const x = e as any;
    throw Error(
      [
        x.message,
        x.where,
        x.position &&
          x.query?.slice(Number(x.position) - 180, Number(x.position) + 180),
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
}

async function billingSetup(db: any) {
  const baseline = await readFile(
      "supabase/migrations/20261028173902_finviant_complete_application_bootstrap.sql",
      "utf8",
    ),
    owner = await readFile(
      "supabase/migrations/20261102170333_owner_team_document_settings.sql",
      "utf8",
    );
  function fn(text: string, name: string) {
    const a = text.indexOf("CREATE OR REPLACE FUNCTION " + name + "(");
    if (a < 0) throw Error("Missing function " + name);
    return text.slice(a, text.indexOf("$function$;", a) + 12);
  }
  for (const table of ["change_order_items", "payments"]) {
    const match = baseline.match(
      new RegExp(
        'create table "public"\\."' + table + '" \\(([\\s\\S]*?)\\);',
        "i",
      ),
    )!;
    await db.exec(
      "create table public." +
        table +
        " (" +
        match[1] +
        ");alter table " +
        table +
        " add primary key(id);",
    );
  }
  await db.exec(
    "alter table public.change_orders drop column source_invoice_id;",
  );
  await db.exec(fn(baseline, "private.valid_payment_links"));
  const a = owner.indexOf(
    "create function private.guard_invoice_destinations(",
  );
  await db.exec(owner.slice(a, owner.indexOf("end $$;", a) + 7));
  for (const name of [
    "public.recalc_change_order",
    "private.commerce_change_item_guard",
  ])
    await db.exec(fn(baseline, name));
  await db.exec(
    "create trigger change_item_guard before insert or update or delete on change_order_items for each row execute function private.commerce_change_item_guard();create trigger change_items_recalc after insert or update or delete on change_order_items for each row execute function public.recalc_change_order();grant select,insert,update,delete on change_orders,change_order_items,payments to authenticated;",
  );
  await db.exec(
    await readFile(
      "supabase/migrations/20261102231643_document_workflow_and_contact_import.sql",
      "utf8",
    ),
  );
  for (const name of [
    "public.record_manual_payment",
    "private.commerce_paid_recalc",
    "private.commerce_payment_guard",
  ])
    await db.exec(fn(baseline, name));
  await db.exec(
    "create trigger payments_guard before insert or update or delete on payments for each row execute function private.commerce_payment_guard();create trigger payment_recalc after insert or update or delete on payments for each row execute function private.commerce_paid_recalc();",
  );
  await db.exec(
    await readFile(
      "supabase/migrations/20261106131110_estimate_deposit_final_balance.sql",
      "utf8",
    ),
  );
  return "select 1;";
}

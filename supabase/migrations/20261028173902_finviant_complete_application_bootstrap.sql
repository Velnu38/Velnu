-- Complete application schema baseline captured from staging on 2026-10-28.

-- New, empty production project only. No users, business records, sessions or secrets.

-- Supabase-managed auth/storage tables and triggers are intentionally not recreated.

set check_function_bodies = false;

set search_path = public, extensions;

create schema if not exists private;

create extension if not exists pgcrypto with schema extensions;

create table "private"."business_entitlements" (
  "business_id" uuid not null,
  "plan" text default 'free'::text not null,
  "valid_until" timestamp with time zone,
  "updated_at" timestamp with time zone default now() not null
);

create table "private"."feature_requests" (
  "business_id" uuid not null,
  "feature" text not null,
  "request_id" uuid not null,
  "created_at" timestamp with time zone default now() not null
);

create table "private"."finviant_ai_attempt_budget" (
  "business_id" uuid not null,
  "period" date not null,
  "kind" text not null,
  "attempts" integer default 0 not null,
  "minute_start" timestamp with time zone default now() not null,
  "minute_attempts" integer default 0 not null
);

create table "private"."finviant_delivery_events" (
  "event_id" text not null,
  "provider_id" text not null,
  "event_type" text not null,
  "occurred_at" timestamp with time zone not null,
  "received_at" timestamp with time zone default now() not null
);

create table "private"."finviant_email_outbox" (
  "id" uuid not null,
  "business_id" uuid not null,
  "actor_id" uuid not null,
  "document_kind" text not null,
  "document_id" uuid not null,
  "payload" jsonb not null,
  "status" text default 'queued'::text not null,
  "attempts" integer default 0 not null,
  "lease_id" uuid,
  "lease_until" timestamp with time zone,
  "provider_id" text,
  "created_at" timestamp with time zone default now() not null,
  "next_attempt_at" timestamp with time zone default now() not null,
  "last_code" text,
  "last_event_at" timestamp with time zone
);

create table "private"."finviant_payment_events" (
  "event_id" text not null,
  "account_id" text not null,
  "object_id" text not null,
  "event_type" text not null,
  "provider_created_at" timestamp with time zone not null,
  "received_at" timestamp with time zone default now() not null,
  "state" text default 'awaiting_reconciliation'::text not null,
  "livemode" boolean not null
);

create table "private"."monthly_usage" (
  "business_id" uuid not null,
  "month" date not null,
  "documents" integer default 0 not null,
  "ai" integer default 0 not null,
  "voice" integer default 0 not null,
  "email" integer default 0 not null,
  "invoice_estimate_documents" integer default 0 not null
);

create table "public"."ai_actions" (
  "id" uuid default gen_random_uuid() not null,
  "business_id" uuid not null,
  "user_id" uuid not null,
  "source" text default 'text'::text not null,
  "raw_input" text,
  "intent" text,
  "parsed_payload" jsonb default '{}'::jsonb not null,
  "status" text default 'proposed'::text not null,
  "requires_confirmation" boolean default true not null,
  "error_message" text,
  "created_at" timestamp with time zone default now() not null,
  "confirmed_at" timestamp with time zone,
  "executed_at" timestamp with time zone
);

create table "public"."appointments" (
  "id" uuid default gen_random_uuid() not null,
  "business_id" uuid not null,
  "job_id" uuid,
  "customer_id" uuid,
  "assigned_user_id" uuid,
  "title" text not null,
  "starts_at" timestamp with time zone not null,
  "ends_at" timestamp with time zone,
  "status" text default 'scheduled'::text not null,
  "notes" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table "public"."bookkeeping_entries" (
  "id" uuid default gen_random_uuid() not null,
  "business_id" uuid not null,
  "created_by" uuid default auth.uid() not null,
  "entry_date" date not null,
  "direction" text not null,
  "amount" numeric(14,2) not null,
  "currency" text default 'USD'::text not null,
  "category" text not null,
  "description" text not null,
  "notes" text,
  "created_at" timestamp with time zone default now() not null
);

create table "public"."business_branding" (
  "business_id" uuid not null,
  "logo_data_url" text not null,
  "updated_at" timestamp with time zone default now() not null
);

create table "public"."business_members" (
  "business_id" uuid not null,
  "user_id" uuid not null,
  "role" text default 'owner'::text not null,
  "created_at" timestamp with time zone default now() not null
);

create table "public"."business_service_interests" (
  "business_id" uuid not null,
  "selected_services" text[] default '{}'::text[] not null,
  "preferred_plan" text default 'free'::text not null,
  "updated_by" uuid not null,
  "updated_at" timestamp with time zone default now() not null
);

create table "public"."business_settings" (
  "business_id" uuid not null,
  "payment_links" jsonb default '[]'::jsonb not null,
  "payment_instructions" text default ''::text not null,
  "updated_at" timestamp with time zone default now() not null
);

create table "public"."businesses" (
  "id" uuid default gen_random_uuid() not null,
  "name" text not null,
  "legal_name" text,
  "email" text,
  "phone" text,
  "website" text,
  "address_line1" text,
  "address_line2" text,
  "city" text,
  "state" text,
  "postal_code" text,
  "country" text default 'US'::text not null,
  "timezone" text default 'America/New_York'::text not null,
  "currency" text default 'USD'::text not null,
  "invoice_prefix" text default 'INV'::text not null,
  "next_invoice_number" bigint default 1001 not null,
  "estimate_prefix" text default 'EST'::text not null,
  "next_estimate_number" bigint default 1001 not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "created_by_user_id" uuid default auth.uid(),
  "change_order_prefix" text default 'CO'::text not null,
  "next_change_order_number" bigint default 1001 not null,
  "logo_path" text,
  "business_description" text,
  "services_offered" text,
  "service_area" text,
  "team_size" integer,
  "team_roles" text,
  "document_accent" text default '#2563eb'::text not null,
  "document_footer" text,
  "profile_completed_at" timestamp with time zone
);

create table "public"."change_order_items" (
  "id" uuid default gen_random_uuid() not null,
  "change_order_id" uuid not null,
  "business_id" uuid not null,
  "description" text not null,
  "quantity" numeric default 1 not null,
  "unit_price" numeric default 0 not null,
  "tax_rate" numeric default 0 not null,
  "line_total" numeric generated always as (round((quantity * unit_price), 2)) stored,
  "sort_order" integer default 0 not null,
  "created_at" timestamp with time zone default now() not null
);

create table "public"."change_orders" (
  "id" uuid default gen_random_uuid() not null,
  "business_id" uuid not null,
  "customer_id" uuid not null,
  "job_id" uuid not null,
  "estimate_id" uuid,
  "change_order_number" text,
  "status" text default 'draft'::text not null,
  "title" text not null,
  "description" text,
  "reason" text,
  "schedule_impact_days" integer default 0 not null,
  "schedule_note" text,
  "issue_date" date default CURRENT_DATE not null,
  "subtotal" numeric default 0 not null,
  "tax_amount" numeric default 0 not null,
  "total" numeric default 0 not null,
  "notes" text,
  "customer_message" text,
  "sent_at" timestamp with time zone,
  "approved_at" timestamp with time zone,
  "declined_at" timestamp with time zone,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "request_id" uuid,
  "request_fingerprint" text,
  "issuer_snapshot" jsonb
);

create table "public"."customers" (
  "id" uuid default gen_random_uuid() not null,
  "business_id" uuid not null,
  "first_name" text,
  "last_name" text,
  "company" text,
  "email" text,
  "phone" text,
  "preferred_contact" text,
  "notes" text,
  "archived" boolean default false not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table "public"."document_approval_links" (
  "id" uuid default gen_random_uuid() not null,
  "business_id" uuid not null,
  "document_type" text not null,
  "estimate_id" uuid,
  "change_order_id" uuid,
  "token_hash" text not null,
  "expires_at" timestamp with time zone not null,
  "revoked_at" timestamp with time zone,
  "created_by_user_id" uuid default auth.uid(),
  "created_at" timestamp with time zone default now() not null
);

create table "public"."document_approvals" (
  "id" uuid default gen_random_uuid() not null,
  "approval_link_id" uuid not null,
  "business_id" uuid not null,
  "document_type" text not null,
  "estimate_id" uuid,
  "change_order_id" uuid,
  "action" text not null,
  "typed_name" text not null,
  "amount_at_action" numeric not null,
  "document_snapshot" jsonb not null,
  "user_agent" text,
  "created_at" timestamp with time zone default now() not null
);

create table "public"."estimate_items" (
  "id" uuid default gen_random_uuid() not null,
  "estimate_id" uuid not null,
  "business_id" uuid not null,
  "description" text not null,
  "quantity" numeric default 1 not null,
  "unit_price" numeric default 0 not null,
  "tax_rate" numeric default 0 not null,
  "line_total" numeric generated always as (round((quantity * unit_price), 2)) stored,
  "sort_order" integer default 0 not null,
  "created_at" timestamp with time zone default now() not null
);

create table "public"."estimates" (
  "id" uuid default gen_random_uuid() not null,
  "business_id" uuid not null,
  "customer_id" uuid not null,
  "job_id" uuid,
  "estimate_number" text,
  "status" text default 'draft'::text not null,
  "issue_date" date default CURRENT_DATE not null,
  "expires_on" date,
  "subtotal" numeric default 0 not null,
  "tax_amount" numeric default 0 not null,
  "total" numeric default 0 not null,
  "notes" text,
  "customer_message" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "request_id" uuid,
  "request_fingerprint" text,
  "issuer_snapshot" jsonb
);

create table "public"."invoice_items" (
  "id" uuid default gen_random_uuid() not null,
  "invoice_id" uuid not null,
  "business_id" uuid not null,
  "description" text not null,
  "quantity" numeric default 1 not null,
  "unit_price" numeric default 0 not null,
  "tax_rate" numeric default 0 not null,
  "line_total" numeric generated always as (round((quantity * unit_price), 2)) stored,
  "sort_order" integer default 0 not null,
  "created_at" timestamp with time zone default now() not null
);

create table "public"."invoices" (
  "id" uuid default gen_random_uuid() not null,
  "business_id" uuid not null,
  "customer_id" uuid not null,
  "job_id" uuid,
  "estimate_id" uuid,
  "invoice_number" text,
  "status" text default 'draft'::text not null,
  "issue_date" date default CURRENT_DATE not null,
  "due_date" date,
  "subtotal" numeric default 0 not null,
  "tax_amount" numeric default 0 not null,
  "total" numeric default 0 not null,
  "amount_paid" numeric default 0 not null,
  "balance_due" numeric generated always as (GREATEST((total - amount_paid), (0)::numeric)) stored,
  "notes" text,
  "customer_message" text,
  "sent_at" timestamp with time zone,
  "paid_at" timestamp with time zone,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "payment_links" jsonb default '[]'::jsonb not null,
  "payment_instructions" text default ''::text not null,
  "request_id" uuid,
  "request_fingerprint" text,
  "issuer_snapshot" jsonb
);

create table "public"."jobs" (
  "id" uuid default gen_random_uuid() not null,
  "business_id" uuid not null,
  "customer_id" uuid not null,
  "property_id" uuid,
  "title" text not null,
  "description" text,
  "status" text default 'scheduled'::text not null,
  "scheduled_start" timestamp with time zone,
  "scheduled_end" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "internal_notes" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "request_id" uuid,
  "request_fingerprint" text
);

create table "public"."messages" (
  "id" uuid default gen_random_uuid() not null,
  "business_id" uuid not null,
  "customer_id" uuid,
  "invoice_id" uuid,
  "estimate_id" uuid,
  "direction" text not null,
  "channel" text not null,
  "recipient" text,
  "subject" text,
  "body" text not null,
  "provider" text,
  "provider_message_id" text,
  "status" text default 'queued'::text not null,
  "sent_at" timestamp with time zone,
  "created_at" timestamp with time zone default now() not null,
  "change_order_id" uuid,
  "email_payload_hash" text
);

create table "public"."payments" (
  "id" uuid default gen_random_uuid() not null,
  "business_id" uuid not null,
  "invoice_id" uuid not null,
  "amount" numeric not null,
  "method" text,
  "provider" text,
  "provider_payment_id" text,
  "status" text default 'succeeded'::text not null,
  "paid_at" timestamp with time zone default now() not null,
  "notes" text,
  "created_at" timestamp with time zone default now() not null,
  "request_id" uuid
);

create table "public"."properties" (
  "id" uuid default gen_random_uuid() not null,
  "business_id" uuid not null,
  "customer_id" uuid not null,
  "label" text,
  "address_line1" text not null,
  "address_line2" text,
  "city" text,
  "state" text,
  "postal_code" text,
  "access_notes" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table "public"."quickbooks_connections" (
  "business_id" uuid not null,
  "realm_id" text not null,
  "environment" text default 'sandbox'::text not null,
  "access_token_encrypted" text not null,
  "refresh_token_encrypted" text not null,
  "access_expires_at" timestamp with time zone not null,
  "connected_by" uuid not null,
  "connected_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "last_sync_at" timestamp with time zone,
  "last_sync_count" integer default 0 not null
);

create table "public"."quickbooks_oauth_states" (
  "state_hash" text not null,
  "business_id" uuid not null,
  "initiated_by" uuid not null,
  "environment" text not null,
  "created_at" timestamp with time zone default now() not null,
  "expires_at" timestamp with time zone not null,
  "used_at" timestamp with time zone
);

create table "public"."quickbooks_transactions" (
  "id" uuid default gen_random_uuid() not null,
  "business_id" uuid not null,
  "realm_id" text not null,
  "source_type" text not null,
  "source_id" text not null,
  "direction" text not null,
  "txn_date" date not null,
  "amount" numeric(14,2) not null,
  "currency" text default 'USD'::text not null,
  "description" text not null,
  "source_updated_at" timestamp with time zone,
  "last_seen_at" timestamp with time zone default now() not null
);

create table "public"."reminders" (
  "id" uuid default gen_random_uuid() not null,
  "business_id" uuid not null,
  "customer_id" uuid,
  "invoice_id" uuid,
  "estimate_id" uuid,
  "job_id" uuid,
  "kind" text not null,
  "due_at" timestamp with time zone not null,
  "status" text default 'pending'::text not null,
  "note" text,
  "created_at" timestamp with time zone default now() not null,
  "completed_at" timestamp with time zone
);

create table "public"."user_agreement_acceptances" (
  "id" uuid default gen_random_uuid() not null,
  "user_id" uuid not null,
  "agreement_version" text not null,
  "terms_accepted" boolean not null,
  "ai_disclosure_acknowledged" boolean not null,
  "electronic_records_consent" boolean not null,
  "acceptance_method" text default 'checkbox_and_button'::text not null,
  "accepted_at" timestamp with time zone default now() not null,
  "selected_tier_at_acceptance" text
);

create table "public"."user_plan_preferences" (
  "user_id" uuid not null,
  "selected_tier" text not null,
  "selected_at" timestamp with time zone default now() not null
);

create table "public"."user_profiles" (
  "user_id" uuid not null,
  "full_name" text,
  "phone" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table "public"."voice_transcriptions" (
  "id" uuid default gen_random_uuid() not null,
  "business_id" uuid not null,
  "user_id" uuid not null,
  "provider" text default 'openai'::text not null,
  "model" text,
  "transcript" text not null,
  "duration_seconds" numeric,
  "confidence" numeric,
  "created_at" timestamp with time zone default now() not null
);

CREATE OR REPLACE FUNCTION private.ai_confirmation_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$begin if current_user in('authenticated','anon') then if auth.uid() is null or auth.uid()<>old.user_id or not private.is_pro(old.business_id) or old.status<>'proposed' or new.status not in('confirmed','rejected') then raise exception 'Only your own pending Pro proposals can be confirmed or rejected' using errcode='42501';end if;if old.parsed_payload->>'clarification_question' is not null and new.status='confirmed' then raise exception 'Clarify this command before confirming';end if;end if;return new;end$function$;

CREATE OR REPLACE FUNCTION private.can_write_business(target_business_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select private.velnu_has_accepted_terms() and exists (
    select 1 from public.business_members bm
    where bm.business_id=target_business_id and bm.user_id=(select auth.uid())
      and bm.role in ('owner','admin','office','technician')
  );
$function$;

CREATE OR REPLACE FUNCTION private.commerce_auxiliary_limit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$declare n bigint;lim integer;b uuid;begin b:=new.business_id;if pg_column_size(to_jsonb(new))>(case when private.is_pro(b) then 65536 else 16384 end) then raise exception 'Record is too large for this plan';end if;if tg_op='UPDATE' then if new.business_id<>old.business_id then raise exception 'Records cannot move between workspaces';end if;return new;end if;lim:=case when tg_table_name='business_members' then(case when private.is_pro(b) then 5 else 1 end) when private.is_pro(b) then 20000 else 1000 end;perform pg_advisory_xact_lock(hashtextextended('storage-'||b::text||tg_table_name,0));execute format('select count(*) from public.%I where business_id=$1',tg_table_name) into n using b;if n>=lim then raise exception 'Stored % limit reached (%)',tg_table_name,lim;end if;return new;end$function$;

CREATE OR REPLACE FUNCTION private.commerce_business_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$begin if tg_op='INSERT' and auth.uid() is not null then perform pg_advisory_xact_lock(hashtextextended('business-owner-'||auth.uid()::text,0));if exists(select 1 from public.businesses where created_by_user_id=auth.uid()) then raise exception 'One workspace per account is supported in this version';end if;new.created_by_user_id:=auth.uid();elsif tg_op='UPDATE' and new.created_by_user_id is distinct from old.created_by_user_id then raise exception 'Workspace creator cannot be changed';end if;if length(btrim(new.name)) not between 1 and 120 then raise exception 'Business name must be 1 to 120 characters';end if;if not exists(select 1 from pg_timezone_names where name=new.timezone) then raise exception 'Invalid business timezone';end if;return new;end$function$;

CREATE OR REPLACE FUNCTION private.commerce_change_item_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$declare s text;cid uuid;begin cid:=case when tg_op='DELETE' then old.change_order_id else new.change_order_id end;select status into s from public.change_orders where id=cid for update;if s is not null and s<>'draft' then raise exception 'Only draft change-order lines can change';end if;if tg_op='DELETE' then return old;end if;if tg_op='UPDATE' and(new.change_order_id<>old.change_order_id or new.business_id<>old.business_id) then raise exception 'Line ownership cannot change';end if;if length(btrim(new.description)) not between 1 and 1000 or new.quantity<=0 or new.quantity>100000 or new.quantity<>round(new.quantity,2) or new.unit_price<0 or new.unit_price>10000000 or new.unit_price<>round(new.unit_price,2) or new.tax_rate<0 or new.tax_rate>100 or new.tax_rate<>round(new.tax_rate,2) then raise exception 'Invalid change-order line item';end if;if tg_op='INSERT' and(select count(*) from public.change_order_items where change_order_id=cid)>=50 then raise exception 'Maximum 50 lines';end if;return new;end$function$;

CREATE OR REPLACE FUNCTION private.commerce_document_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$declare has_items boolean;begin if tg_op='INSERT' then if new.status<>'draft' or new.subtotal<>0 or new.tax_amount<>0 or new.total<>0 then raise exception 'New documents must start as empty drafts';end if;if tg_table_name='invoices' and(to_jsonb(new)->>'amount_paid')::numeric<>0 then raise exception 'Payments must be recorded separately';end if;return new;end if;if tg_op='DELETE' then if old.status<>'draft' then raise exception 'Issued documents cannot be deleted; void the invoice instead';end if;return old;end if;if new.business_id<>old.business_id or new.created_at<>old.created_at or new.issue_date<>old.issue_date then raise exception 'Document ownership and creation date cannot change';end if;if pg_trigger_depth()=1 and(new.subtotal<>old.subtotal or new.tax_amount<>old.tax_amount or new.total<>old.total or(tg_table_name='invoices' and(to_jsonb(new)->>'amount_paid') is distinct from(to_jsonb(old)->>'amount_paid'))) then raise exception 'Totals are calculated from line items and verified payment records';end if;if old.status<>'draft' and(new.customer_id<>old.customer_id or new.customer_message is distinct from old.customer_message) then raise exception 'Issued customer-facing details cannot be changed';end if;if new.status<>old.status then if tg_table_name='invoices' then if old.status='void' then raise exception 'A void invoice cannot be reopened';end if;if new.status='void' and new.amount_paid>0 then raise exception 'An invoice with recorded payments cannot be voided';end if;if pg_trigger_depth()=1 and new.status in('paid','partial') then raise exception 'Record a payment instead of changing the payment status';end if;if old.status<>'draft' and new.status='draft' and pg_trigger_depth()=1 then raise exception 'An issued invoice cannot become a draft';end if;if new.status='sent' and old.status='draft' then new.sent_at:=now();end if;else if old.status='converted' then raise exception 'Converted estimates cannot change status';end if;if new.status='converted' and not exists(select 1 from public.invoices where estimate_id=new.id and business_id=new.business_id) then raise exception 'Use Create invoice to convert an estimate';end if;if old.status in('accepted','declined') and new.status<>'converted' then raise exception 'The estimate already has a decision; duplicate it to revise it';end if;end if;execute format('select exists(select 1 from public.%I where %I=$1)',case when tg_table_name='invoices' then 'invoice_items' else 'estimate_items' end,case when tg_table_name='invoices' then 'invoice_id' else 'estimate_id' end) into has_items using new.id;if new.status not in('draft','void','expired') and not has_items then raise exception 'Add line items before issuing a document';end if;end if;return new;end$function$;

CREATE OR REPLACE FUNCTION private.commerce_identity_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$begin if new.id<>old.id or new.request_id is distinct from old.request_id or new.request_fingerprint is distinct from old.request_fingerprint or coalesce(to_jsonb(new)->>'invoice_number',to_jsonb(new)->>'estimate_number') is distinct from coalesce(to_jsonb(old)->>'invoice_number',to_jsonb(old)->>'estimate_number') then raise exception 'Document identity and request history cannot change';end if;if tg_table_name='invoices' then if new.estimate_id is distinct from old.estimate_id then raise exception 'Invoice conversion history cannot change';end if;if old.status<>'draft' and(new.payment_links<>old.payment_links or new.payment_instructions<>old.payment_instructions or new.due_date is distinct from old.due_date) then raise exception 'Issued payment instructions and due dates are locked. Create a revised document instead.';end if;else if new.status in('accepted','declined') and old.status<>new.status and new.expires_on<(now() at time zone(select timezone from public.businesses where id=new.business_id))::date then raise exception 'The estimate has expired. Duplicate it and issue a new estimate.';end if;end if;return new;end$function$;

CREATE OR REPLACE FUNCTION private.commerce_item_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$declare s text;par uuid;cnt integer;begin if tg_op='DELETE' then par:=coalesce(to_jsonb(old)->>'invoice_id',to_jsonb(old)->>'estimate_id')::uuid;else par:=coalesce(to_jsonb(new)->>'invoice_id',to_jsonb(new)->>'estimate_id')::uuid;end if;execute format('select status from public.%I where id=$1 for update',case when tg_table_name='invoice_items' then 'invoices' else 'estimates' end) into s using par;if s is not null and s<>'draft' then raise exception 'Only draft line items can be changed. Duplicate the document to revise it.' using errcode='23514';end if;if tg_op='DELETE' then return old;end if;if tg_op='UPDATE' and(new.business_id<>old.business_id or par<>coalesce(to_jsonb(old)->>'invoice_id',to_jsonb(old)->>'estimate_id')::uuid) then raise exception 'Line items cannot move between documents' using errcode='23514';end if;if length(btrim(new.description)) not between 1 and 1000 or new.quantity<=0 or new.quantity>100000 or new.quantity<>round(new.quantity,2) or new.unit_price<0 or new.unit_price>10000000 or new.unit_price<>round(new.unit_price,2) or new.tax_rate<0 or new.tax_rate>100 or new.tax_rate<>round(new.tax_rate,2) then raise exception 'Invalid line item; use two decimal places and a tax percentage from 0 to 100' using errcode='23514';end if;if tg_op='INSERT' then execute format('select count(*) from public.%I where %I=$1',tg_table_name,case when tg_table_name='invoice_items' then 'invoice_id' else 'estimate_id' end) into cnt using par;if cnt>=50 then raise exception 'Maximum 50 lines per document' using errcode='23514';end if;end if;return new;end$function$;

CREATE OR REPLACE FUNCTION private.commerce_number()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$declare num bigint;prefix text;begin if tg_table_name='invoices' then update public.businesses set next_invoice_number=next_invoice_number+1 where id=new.business_id returning next_invoice_number-1,invoice_prefix into num,prefix;new.invoice_number:=prefix||'-'||case when length(num::text)<4 then lpad(num::text,4,'0') else num::text end;else update public.businesses set next_estimate_number=next_estimate_number+1 where id=new.business_id returning next_estimate_number-1,estimate_prefix into num,prefix;new.estimate_number:=prefix||'-'||case when length(num::text)<4 then lpad(num::text,4,'0') else num::text end;end if;return new;end$function$;

CREATE OR REPLACE FUNCTION private.commerce_paid_recalc()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$declare i uuid;paid numeric(12,2);begin i:=case when tg_op='DELETE' then old.invoice_id else new.invoice_id end;select coalesce(sum(amount) filter(where status='succeeded'),0) into paid from public.payments where invoice_id=i;update public.invoices set amount_paid=paid,status=case when status='void' then 'void' when total>0 and paid>=total then 'paid' when paid>0 then 'partial' when sent_at is null then 'draft' else 'sent' end,paid_at=case when total>0 and paid>=total then coalesce(paid_at,now()) else null end where id=i;if tg_op='DELETE' then return old;end if;return new;end$function$;

CREATE OR REPLACE FUNCTION private.commerce_payment_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$declare s text;begin if tg_op='DELETE' then raise exception 'Payment records cannot be deleted';end if;if tg_op='UPDATE' and(new.invoice_id<>old.invoice_id or new.business_id<>old.business_id or new.amount<>old.amount or new.paid_at<>old.paid_at) then raise exception 'Posted payment details are immutable';end if;select status into s from public.invoices where id=new.invoice_id and business_id=new.business_id for update;if s is null or s in('draft','void') then raise exception 'Payments require an issued non-void invoice';end if;if new.amount<>round(new.amount,2) or new.amount>1000000000 then raise exception 'Invalid payment amount';end if;if new.status='partially_refunded' then raise exception 'Partial refunds require a dedicated refund ledger and are not supported yet';end if;return new;end$function$;

CREATE OR REPLACE FUNCTION private.commerce_quota()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  pro boolean;
  m date := date_trunc('month', now() at time zone 'UTC')::date;
  n bigint;
  total bigint;
  lim integer;
begin
  pro := private.is_pro(new.business_id);
  insert into private.monthly_usage(business_id,month)
  values(new.business_id,m) on conflict do nothing;
  perform 1 from private.monthly_usage
   where business_id=new.business_id and month=m for update;

  if tg_table_name='customers' then
    select count(*) into n from public.customers
    where business_id=new.business_id;
    lim:=case when pro then 5000 else 250 end;
    if n>=lim then
      raise exception 'Customer storage limit reached (%)',lim
      using errcode='23514';
    end if;

  elsif tg_table_name in ('invoices','estimates','change_orders') then
    -- Free: ten invoices and estimates combined, per UTC month.
    -- Change orders retain the existing general document quota but do NOT
    -- consume invoice/estimate slots.
    if not pro and tg_table_name in ('invoices','estimates') then
      select invoice_estimate_documents into n
      from private.monthly_usage where business_id=new.business_id and month=m;
      if n>=10 then
        raise exception 'Free plan limit reached: 10 invoices and estimates combined per month. Existing records remain available.'
        using errcode='23514';
      end if;
    end if;

    -- Overall safeguard remains in place for change orders and premium usage.
    select documents into n from private.monthly_usage
      where business_id=new.business_id and month=m;
    lim:=case when pro then 1000 else 100 end;
    if n>=lim then
      raise exception 'Monthly document limit reached (%). Existing documents remain available.',lim
      using errcode='23514';
    end if;

    select
      (select count(*) from public.invoices where business_id=new.business_id)
      +(select count(*) from public.estimates where business_id=new.business_id)
      +(select count(*) from public.change_orders where business_id=new.business_id)
      into total;
    if total >= (case when pro then 20000 else 1000 end) then
      raise exception 'Stored document limit reached. Export your records or upgrade.'
      using errcode='23514';
    end if;

    update private.monthly_usage
      set documents=documents+1,
        invoice_estimate_documents=invoice_estimate_documents
          + case when tg_table_name in ('invoices','estimates') then 1 else 0 end
      where business_id=new.business_id and month=m;
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.commerce_recalc()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$declare parent uuid;b uuid;st numeric(12,2);tx numeric(12,2);kind text;begin if tg_op='DELETE' then parent:=coalesce(to_jsonb(old)->>'invoice_id',to_jsonb(old)->>'estimate_id')::uuid;b:=old.business_id;else parent:=coalesce(to_jsonb(new)->>'invoice_id',to_jsonb(new)->>'estimate_id')::uuid;b:=new.business_id;end if;kind:=case when tg_table_name='invoice_items' then 'invoices' else 'estimates' end;execute format('select coalesce(sum(line_total),0),coalesce(sum(round(line_total*tax_rate/100,2)),0) from public.%I where %I=$1 and business_id=$2',tg_table_name,case when kind='invoices' then 'invoice_id' else 'estimate_id' end) into st,tx using parent,b;execute format('update public.%I set subtotal=$1,tax_amount=$2,total=$1+$2 where id=$3 and business_id=$4',kind) using st,tx,parent,b;if tg_op='DELETE' then return old;end if;return new;end$function$;

CREATE OR REPLACE FUNCTION private.execute_confirmed_action(target_action_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a public.ai_actions%rowtype;f jsonb;r jsonb;customer uuid;matches integer;requested text;obj uuid;job uuid;doc jsonb;item jsonb;k integer:=0;kind text;start_at timestamptz;end_at timestamptz;
begin
if auth.uid() is null then raise exception 'Sign in to continue' using errcode='42501';end if;
select * into a from public.ai_actions where id=target_action_id and user_id=auth.uid() for update;
if not found or not private.can_write_business(a.business_id) or not private.is_pro(a.business_id) then raise exception 'This action requires Pro and access to the business' using errcode='42501';end if;
if a.status='executed' then return jsonb_build_object('action_id',a.id,'status','executed','result',a.parsed_payload->'execution_result','already_executed',true);end if;
if a.parsed_payload->>'clarification_question' is not null then raise exception 'Clarify the command before executing';end if;
if a.intent in('list_unpaid_invoices','customer_history','business_summary') then if a.status not in('proposed','confirmed') then raise exception 'Action is not ready';end if;elsif a.status<>'confirmed' then raise exception 'Review and confirm this action first';end if;f:=a.parsed_payload->'fields';
if a.intent in('create_job','create_invoice','create_estimate','schedule_job','create_change_order','customer_history') then requested:=lower(regexp_replace(btrim(coalesce(f->>'customer_name',f->>'company_name','')),'\s+',' ','g'));if requested='' then raise exception 'Specify the customer name';end if;select count(*),min(id::text)::uuid into matches,customer from public.customers where business_id=a.business_id and not archived and(lower(regexp_replace(btrim(concat_ws(' ',first_name,last_name)),'\s+',' ','g'))=requested or lower(regexp_replace(btrim(coalesce(company,'')),'\s+',' ','g'))=requested);if matches<>1 then raise exception 'Found % matching customers. Use the manual form to select the correct customer.',matches;end if;end if;
case a.intent
when 'create_customer' then
if nullif(btrim(coalesce(f->>'customer_name',f->>'company_name','')),'') is null then raise exception 'Customer name required';end if;
insert into public.customers(business_id,first_name,last_name,company,email,phone,notes) values(a.business_id,nullif(split_part(coalesce(f->>'customer_name',''),' ',1),''),nullif(regexp_replace(coalesce(f->>'customer_name',''),'^[^ ]+\s*',''),''),f->>'company_name',f->>'email',f->>'phone',f->>'notes') returning id into obj;select jsonb_build_object('customer',to_jsonb(c)) into r from public.customers c where id=obj;
when 'create_invoice','create_estimate' then
kind:=case when a.intent='create_invoice' then 'invoice' else 'estimate' end;doc:=public.create_document(a.business_id,kind,a.id,jsonb_build_object('customer_id',customer,'items',f->'line_items','due_date',case when kind='invoice' then f->>'due_date_text' else null end,'notes',f->>'notes'));r:=jsonb_build_object(kind,doc);
when 'record_payment' then
select count(*),min(id::text)::uuid into matches,obj from public.invoices where business_id=a.business_id and invoice_number=f->>'invoice_number' and(nullif(btrim(coalesce(f->>'customer_name',f->>'company_name','')),'') is null or customer_id in(select id from public.customers where business_id=a.business_id and(lower(btrim(concat_ws(' ',first_name,last_name)))=lower(btrim(coalesce(f->>'customer_name',f->>'company_name'))) or lower(btrim(company))=lower(btrim(coalesce(f->>'customer_name',f->>'company_name'))))));if matches<>1 then raise exception 'Specify the exact invoice number';end if;doc:=public.record_manual_payment(a.business_id,obj,a.id,(f->>'payment_amount')::numeric,coalesce(f->>'payment_method','other'),coalesce(f->>'notes','Manually verified payment, entered with AI assistance'));r:=jsonb_build_object('payment',doc);
when 'create_job','schedule_job' then
if nullif(btrim(coalesce(f->>'job_title',f->>'job_description','')),'') is null then raise exception 'Job title required';end if;
if a.intent='schedule_job' then start_at:=(f->>'scheduled_at_text')::timestamptz;end_at:=(f->>'scheduled_end_text')::timestamptz;if start_at is null or start_at<now() or(end_at is not null and end_at<start_at) then raise exception 'Use a future start time and a valid end time';end if;end if;
insert into public.jobs(business_id,customer_id,title,description,status,scheduled_start,scheduled_end) values(a.business_id,customer,coalesce(f->>'job_title',f->>'job_description'),f->>'job_description',case when a.intent='schedule_job' then 'scheduled' else 'lead' end,start_at,end_at) returning id into job;
if a.intent='schedule_job' then insert into public.appointments(business_id,customer_id,job_id,title,starts_at,ends_at,status) values(a.business_id,customer,job,coalesce(f->>'job_title',f->>'job_description'),start_at,end_at,'scheduled');end if;
select jsonb_build_object('job',to_jsonb(j)) into r from public.jobs j where id=job;
when 'create_change_order' then
select count(*),min(id::text)::uuid into matches,job from public.jobs where business_id=a.business_id and customer_id=customer and status not in('canceled','completed') and(nullif(f->>'job_title','') is null or lower(btrim(title))=lower(btrim(f->>'job_title')));
if matches<>1 then raise exception 'Specify exactly one active job for this customer';end if;if jsonb_typeof(f->'line_items') is distinct from 'array' or jsonb_array_length(f->'line_items') not between 1 and 50 then raise exception 'Add 1 to 50 change-order line items';end if;
insert into public.change_orders(business_id,customer_id,job_id,title,description,reason,schedule_impact_days,schedule_note,status) values(a.business_id,customer,job,coalesce(f->>'change_order_title',f->>'job_description','Change order'),f->>'job_description',f->>'notes',coalesce((f->>'schedule_impact_days')::integer,0),f->>'schedule_note','draft') returning id into obj;
for item in select value from jsonb_array_elements(f->'line_items') loop insert into public.change_order_items(business_id,change_order_id,description,quantity,unit_price,tax_rate,sort_order) values(a.business_id,obj,item->>'description',(item->>'quantity')::numeric,(item->>'unit_price')::numeric,coalesce((item->>'tax_rate')::numeric,0),k);k:=k+1;end loop;
select jsonb_build_object('change_order',to_jsonb(c)) into r from public.change_orders c where id=obj;
when 'business_summary' then r:=public.get_dashboard_metrics(a.business_id);r:=r||jsonb_build_object('customers',r->'customer_count','active_jobs',(select count(*) from public.jobs where business_id=a.business_id and status not in('completed','canceled')));
when 'list_unpaid_invoices' then r:=public.get_dashboard_metrics(a.business_id);r:=jsonb_build_object('count',r->'open_count','total_outstanding',r->'outstanding','invoices',coalesce((select jsonb_agg(to_jsonb(i)) from(select id,invoice_number,balance_due,due_date from public.invoices where business_id=a.business_id and status not in('draft','void') and balance_due>0 order by due_date nulls last limit 50)i),'[]'::jsonb),'list_limit',50);
when 'customer_history' then r:=jsonb_build_object('customer_id',customer,'invoices',coalesce((select jsonb_agg(to_jsonb(i)) from(select id,invoice_number,status,total,balance_due from public.invoices where business_id=a.business_id and customer_id=customer order by created_at desc limit 20)i),'[]'::jsonb),'jobs',coalesce((select jsonb_agg(to_jsonb(j)) from(select id,title,status from public.jobs where business_id=a.business_id and customer_id=customer order by created_at desc limit 20)j),'[]'::jsonb));
else raise exception 'This action is not supported';end case;
update public.ai_actions set status='executed',executed_at=now(),parsed_payload=parsed_payload||jsonb_build_object('execution_result',r) where id=a.id;return jsonb_build_object('action_id',a.id,'status','executed','result',r);
end$function$;

CREATE OR REPLACE FUNCTION private.finviant_ai_decision(p_action_id uuid, p_decision text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a public.ai_actions%rowtype; r text;
begin
  if auth.uid() is null then raise exception 'Sign in required' using errcode='42501'; end if;
  if p_action_id is null or p_decision is null or p_decision not in ('confirmed','rejected') then
    raise exception 'Invalid decision' using errcode='22023'; end if;
  select * into a from public.ai_actions where id=p_action_id and user_id=auth.uid() for update;
  if not found then raise exception 'Action not found' using errcode='P0002'; end if;
  select bm.role into r from public.business_members bm
    where bm.business_id=a.business_id and bm.user_id=auth.uid() for share;
  if r is null or not private.velnu_has_accepted_terms() then
    raise exception 'Business access denied' using errcode='42501'; end if;
  if a.intent in ('create_invoice','create_estimate','record_payment','create_change_order') then
    if r not in ('owner','admin','office') then raise exception 'Finance role required' using errcode='42501'; end if;
  elsif a.intent in ('create_customer','create_job','schedule_job') then
    if r not in ('owner','admin','office','technician') then raise exception 'Write permission required' using errcode='42501'; end if;
  else raise exception 'Unsupported action' using errcode='22023'; end if;
  if p_decision='confirmed' and (a.requires_confirmation is distinct from true or nullif(btrim(a.parsed_payload->>'clarification_question'),'') is not null) then
    raise exception 'Clarify the request before confirming' using errcode='23514'; end if;
  if p_decision='confirmed' and a.status in ('confirmed','executed') and a.confirmed_at is not null then return; end if;
  if p_decision='rejected' and a.status='rejected' then return; end if;
  if a.status<>'proposed' and not (p_decision='rejected' and a.status='confirmed') then
    raise exception 'This action cannot accept that decision' using errcode='23514'; end if;
  update public.ai_actions set status=p_decision,
    confirmed_at=case when p_decision='confirmed' then now() else a.confirmed_at end where id=a.id;
end;
$function$;

CREATE OR REPLACE FUNCTION private.finviant_execute_ai_mutation(p_action_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a public.ai_actions%rowtype; f jsonb; r text; requested text;
 cid uuid; jid uuid; iid uuid; n integer; title_text text; lines jsonb;
 payload jsonb; created jsonb; result jsonb; amount numeric; method text;
 starts timestamptz; ends timestamptz;
begin
 if auth.uid() is null then raise exception 'Not authenticated' using errcode='42501'; end if;
 select * into a from public.ai_actions where id=p_action_id and user_id=auth.uid() for update;
 if not found then raise exception 'Action not found' using errcode='P0002';end if;
 if a.status='executed' then
   return jsonb_build_object('action_id',a.id,'status','executed','result',a.parsed_payload->'execution_result','already_executed',true);
 end if;
 if a.status<>'confirmed' or a.requires_confirmation is distinct from true or a.confirmed_at is null then
   raise exception 'Action requires confirmation' using errcode='23514';end if;
 if a.intent not in ('create_customer','create_job','schedule_job','create_invoice','create_estimate','create_change_order','record_payment') then
   raise exception 'Unsupported action' using errcode='22023';end if;
 select bm.role into r from public.business_members bm
   where bm.business_id=a.business_id and bm.user_id=auth.uid();
 if r is null or not private.velnu_has_accepted_terms() then
   raise exception 'Business access denied' using errcode='42501';end if;
 if a.intent in ('create_invoice','create_estimate','create_change_order','record_payment') and r not in ('owner','admin','office') then
   raise exception 'Finance role required' using errcode='42501';end if;
 if a.intent in ('create_customer','create_job','schedule_job') and r not in ('owner','admin','office','technician') then
   raise exception 'Write permission required' using errcode='42501';end if;
 f:=coalesce(a.parsed_payload->'fields','{}'::jsonb);
 if a.intent='create_customer' then
    requested:=btrim(coalesce(f->>'customer_name',''));
    if requested='' and btrim(coalesce(f->>'company_name',''))='' then raise exception 'Customer name or company required' using errcode='22023';end if;
    if length(requested)>180 then raise exception 'Name too long' using errcode='22023';end if;
    insert into public.customers(business_id,first_name,last_name,company,email,phone,notes)
    values(a.business_id,nullif(split_part(requested,' ',1),''),
      nullif(btrim(substr(requested,length(split_part(requested,' ',1))+1)),''),
      nullif(btrim(f->>'company_name'),''),
      nullif(btrim(f->>'email'),''),
      nullif(btrim(f->>'phone'),''),
      nullif(btrim(f->>'notes'),'')) returning to_jsonb(customers) into created;
    result:=jsonb_build_object('customer',created);
 else
    requested:=lower(btrim(regexp_replace(coalesce(nullif(f->>'customer_name',''),f->>'company_name',''),'\s+',' ','g')));
    if requested='' then raise exception 'CUSTOMER_REQUIRED' using errcode='22023';end if;
    select count(*),min(c.id::text)::uuid into n,cid from public.customers c
    where c.business_id=a.business_id and coalesce(c.archived,false)=false
      and (lower(btrim(concat_ws(' ',c.first_name,c.last_name)))=requested or lower(btrim(coalesce(c.company,'')))=requested);
    if n=0 then raise exception 'CUSTOMER_NOT_FOUND' using errcode='22023';end if;
    if n>1 then raise exception 'CUSTOMER_AMBIGUOUS' using errcode='22023';end if;
    if a.intent='create_job' then
       title_text:=btrim(coalesce(nullif(f->>'job_title',''),f->>'job_description',''));
       if length(title_text) not between 1 and 200 then raise exception 'Job title must be 1-200 characters' using errcode='22023';end if;
       insert into public.jobs(business_id,customer_id,title,description,status)
       values(a.business_id,cid,title_text,nullif(f->>'job_description',''),'lead') returning to_jsonb(jobs) into created;
       result:=jsonb_build_object('job',created);
    elsif a.intent='schedule_job' then
       title_text:=btrim(coalesce(nullif(f->>'job_title',''),f->>'job_description',''));
       if length(title_text) not between 1 and 200 then raise exception 'Job title must be 1-200 characters' using errcode='22023';end if;
       if coalesce(f->>'scheduled_at_text','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$' then
          raise exception 'Scheduled start requires an ISO date and explicit timezone' using errcode='22023';end if;
       starts:=(f->>'scheduled_at_text')::timestamptz;
       ends:=nullif(f->>'scheduled_end_text','')::timestamptz;
       if ends is not null and ends<=starts then raise exception 'End must follow start' using errcode='22023';end if;
       select public.create_scheduled_job(a.business_id,a.id,jsonb_build_object('customer_id',cid,'property_id',null,
          'title',title_text,'description',nullif(f->>'job_description',''),'scheduled_start',starts,'scheduled_end',ends)) into created;
       result:=jsonb_build_object('job',created,'appointment',jsonb_build_object('id',created->>'appointment_id'));
    elsif a.intent in ('create_invoice','create_estimate','create_change_order') then
       lines:=f->'line_items';
       if lines is null or jsonb_typeof(lines)<>'array' or jsonb_array_length(lines) not between 1 and 50 then
         raise exception 'Between 1 and 50 line items required' using errcode='22023';end if;
       if a.intent in ('create_invoice','create_estimate') then
          payload:=jsonb_build_object('customer_id',cid,'items',lines,'notes',nullif(f->>'notes',''),'customer_message',null,
            'due_date',case when a.intent='create_invoice' then nullif(f->>'due_date_text','') else null end,
            'expires_on',case when a.intent='create_estimate' then nullif(f->>'due_date_text','') else null end);
          select public.create_document(a.business_id,case when a.intent='create_invoice' then 'invoice' else 'estimate' end,
            a.id,payload) into created;
          result:=case when a.intent='create_invoice' then jsonb_build_object('invoice',created)
                       else jsonb_build_object('estimate',created) end;
       else
          requested:=lower(btrim(coalesce(f->>'job_title','')));
          if requested<>'' then
             select count(*),min(j.id::text)::uuid into n,jid from public.jobs j
             where j.business_id=a.business_id and j.customer_id=cid and j.status<>'canceled'
               and lower(btrim(j.title))=requested;
          else
             select count(*),min(j.id::text)::uuid into n,jid from public.jobs j
             where j.business_id=a.business_id and j.customer_id=cid and j.status not in ('canceled','completed');
          end if;
          if n=0 then raise exception 'JOB_NOT_FOUND' using errcode='22023';end if;
          if n>1 then raise exception 'JOB_AMBIGUOUS' using errcode='22023';end if;
          title_text:=btrim(coalesce(nullif(f->>'change_order_title',''),nullif(f->>'job_description',''),lines->0->>'description',''));
          payload:=jsonb_build_object('customer_id',cid,'job_id',jid,'estimate_id',null,
            'title',title_text,'description',nullif(f->>'job_description',''),'reason',nullif(f->>'notes',''),
            'schedule_impact_days',coalesce((f->>'schedule_impact_days')::integer,0),
            'schedule_note',nullif(f->>'schedule_note',''),'notes',nullif(f->>'notes',''),
            'customer_message',null,'items',lines);
          select public.create_change_order_document(a.business_id,a.id,payload) into created;
          result:=jsonb_build_object('change_order',created,'job',jsonb_build_object('id',jid));
       end if;
    elsif a.intent='record_payment' then
       amount:=nullif(f->>'payment_amount','')::numeric;
       if amount is null or amount<=0 or amount<>round(amount,2) then raise exception 'Valid payment amount required' using errcode='22023';end if;
       if nullif(btrim(f->>'invoice_number'),'') is not null then
          select count(*),min(i.id::text)::uuid into n,iid from public.invoices i
          where i.business_id=a.business_id and i.customer_id=cid and
            i.invoice_number=(f->>'invoice_number') and i.status not in ('draft','void') and i.balance_due>0;
       else
          select count(*),min(i.id::text)::uuid into n,iid from public.invoices i
          where i.business_id=a.business_id and i.customer_id=cid
            and i.status not in ('draft','void') and i.balance_due>0;
       end if;
       if n=0 then raise exception 'NO_ELIGIBLE_INVOICE' using errcode='22023';end if;
       if n>1 then raise exception 'INVOICE_AMBIGUOUS' using errcode='22023';end if;
       method:=coalesce(nullif(f->>'payment_method',''),'other');
       if method not in ('cash','check','card','ach','other') then method:='other';end if;
       select public.record_manual_payment(a.business_id,iid,a.id,amount,method,
         coalesce(nullif(f->>'notes',''),'Recorded through Finviant Office AI')) into created;
       result:=jsonb_build_object('payment',created,
          'invoice',(select jsonb_build_object('id',id,'invoice_number',invoice_number,'status',status,
                     'amount_paid',amount_paid,'balance_due',balance_due)
                     from public.invoices where id=iid and business_id=a.business_id));
    end if;
 end if;
 update public.ai_actions set status='executed',executed_at=now(),
    parsed_payload=a.parsed_payload||jsonb_build_object('execution_result',result),error_message=null where id=a.id;
 return jsonb_build_object('action_id',a.id,'status','executed','result',result,'already_executed',false);
end;
$function$;

CREATE OR REPLACE FUNCTION private.finviant_guard_active_appointment()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare parent_status text;
begin
  if new.job_id is not null and new.status in ('scheduled','confirmed','in_progress') then
    select j.status into parent_status from public.jobs j
      where j.id=new.job_id and j.business_id=new.business_id for share;
    if not found then raise exception 'Job is unavailable' using errcode='23503'; end if;
    if parent_status in ('completed','canceled') then
      raise exception 'Reopen the job before scheduling another appointment' using errcode='23514'; end if;
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.finviant_reserve_ai_attempt(p_business_id uuid, p_kind text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare b private.finviant_ai_attempt_budget%rowtype; usage jsonb; limit_value integer; stored_usage integer;
  period_start date:=date_trunc('month',now() at time zone 'UTC')::date; next_attempt integer;
begin
 if auth.uid() is null or not private.is_business_member(p_business_id) then raise exception 'Business access denied' using errcode='42501'; end if;
 if p_kind is null or p_kind not in ('command','transcription') then raise exception 'Invalid AI operation' using errcode='22023'; end if;
 usage:=private.get_plan_usage(p_business_id);
 limit_value:=(usage->>case when p_kind='command' then 'ai_limit' else 'voice_limit' end)::integer;
 stored_usage:=coalesce((usage->>case when p_kind='command' then 'ai_used' else 'voice_used' end)::integer,0);
 if usage->>'plan'<>'pro' or coalesce(limit_value,0)<=0 then raise exception 'Activated AI plan required' using errcode='42501'; end if;
 insert into private.finviant_ai_attempt_budget(business_id,period,kind) values(p_business_id,period_start,p_kind) on conflict do nothing;
 select * into b from private.finviant_ai_attempt_budget where business_id=p_business_id and period=period_start and kind=p_kind for update;
 next_attempt:=greatest(b.attempts,stored_usage)+1;
 if next_attempt>limit_value then raise exception 'AI_ATTEMPT_BUDGET_EXHAUSTED' using errcode='P0001'; end if;
 if b.minute_start>now()-interval '1 minute' and b.minute_attempts>=10 then raise exception 'AI_RATE_LIMIT' using errcode='P0001'; end if;
 update private.finviant_ai_attempt_budget set attempts=next_attempt,
 minute_attempts=case when b.minute_start<=now()-interval '1 minute' then 1 else b.minute_attempts+1 end,
 minute_start=case when b.minute_start<=now()-interval '1 minute' then now() else b.minute_start end
 where business_id=p_business_id and period=period_start and kind=p_kind;
 return jsonb_build_object('reserved',true,'remaining',limit_value-next_attempt,'period',period_start);
end;
$function$;

CREATE OR REPLACE FUNCTION private.finviant_sync_job_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if new.status in ('completed','canceled') then
    update public.appointments set status=new.status
      where business_id=new.business_id and job_id=new.id and status in ('scheduled','confirmed','in_progress');
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.get_plan_usage(target_business_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  pro boolean;
  u private.monthly_usage%rowtype;
  stored bigint;
  people bigint;
begin
  if auth.uid() is null or not private.is_business_member(target_business_id) then
    raise exception 'Not authorized' using errcode='42501';
  end if;
  pro:=private.is_pro(target_business_id);
  select * into u from private.monthly_usage
    where business_id=target_business_id
      and month=date_trunc('month',now() at time zone 'UTC')::date;
  select (select count(*) from public.invoices where business_id=target_business_id)
       +(select count(*) from public.estimates where business_id=target_business_id)
       +(select count(*) from public.change_orders where business_id=target_business_id) into stored;
  select count(*) into people from public.customers where business_id=target_business_id;

  return jsonb_build_object(
    'plan',case when pro then 'pro' else 'free' end,
    'period_end',(date_trunc('month',now() at time zone 'UTC')+interval '1 month')::date,
    'documents_used', case when pro then coalesce(u.documents,0) else coalesce(u.invoice_estimate_documents,0) end,
    'documents_limit', case when pro then 1000 else 10 end,
    'invoice_estimate_documents_used',coalesce(u.invoice_estimate_documents,0),
    'invoice_estimate_documents_limit',case when pro then 1000 else 10 end,
    'stored_documents',stored,
    'stored_limit',case when pro then 20000 else 1000 end,
    'customers_used',people,
    'customers_limit',case when pro then 5000 else 250 end,
    'ai_used',coalesce(u.ai,0),
    'ai_limit',case when pro then 50 else 0 end,
    'voice_used',coalesce(u.voice,0),
    'voice_limit',case when pro then 50 else 0 end,
    'email_used',coalesce(u.email,0),
    'email_limit',case when pro then 250 else 0 end,
    'logo_bytes_limit',case when pro then 131072 else 0 end
  );
end;
$function$;

CREATE OR REPLACE FUNCTION private.has_business_role(target_business_id uuid, allowed_roles text[])
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select private.velnu_has_accepted_terms() and exists (
    select 1 from public.business_members bm
    where bm.business_id=target_business_id and bm.user_id=(select auth.uid())
      and bm.role=any(allowed_roles)
  );
$function$;

CREATE OR REPLACE FUNCTION private.is_business_member(target_business_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select private.velnu_has_accepted_terms() and exists (
    select 1 from public.business_members bm
    where bm.business_id=target_business_id and bm.user_id=(select auth.uid())
  );
$function$;

CREATE OR REPLACE FUNCTION private.is_pro(b uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$select exists(select 1 from private.business_entitlements where business_id=b and plan='pro' and (valid_until is null or valid_until>now()));$function$;

CREATE OR REPLACE FUNCTION private.set_user_agreement_acceptance_time()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  new.accepted_at := now();
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.touch_business_service_interests()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.valid_payment_links(links jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare x jsonb;u text;p text;
begin
if jsonb_typeof(links)<>'array' or jsonb_array_length(links)>5 then return false;end if;
for x in select value from jsonb_array_elements(links) loop
if jsonb_typeof(x)<>'object' then return false;end if;u:=x->>'url';p:=x->>'provider';
if u is null or p is null or length(u)>1000 or u ~ '[[:space:]<>"\\]' or u ~* '%(0a|0d|09|00)' then return false;end if;
if not(case p when 'stripe' then u ~ '^https://(buy\.stripe\.com|invoice\.stripe\.com|checkout\.stripe\.com)/[A-Za-z0-9/?&=_%.~+:#-]+$' when 'venmo' then u ~ '^https://(www\.|account\.)?venmo\.com/[A-Za-z0-9/?&=_%.~+:#-]+$' when 'paypal' then u ~ '^https://(paypal\.me|www\.paypal\.com|paypal\.com)/[A-Za-z0-9/?&=_%.~+:#-]+$' when 'square' then u ~ '^https://(square\.link|invoice\.squareup\.com)/[A-Za-z0-9/?&=_%.~+:#-]+$' when 'cashapp' then u ~ '^https://cash\.app/\$[A-Za-z0-9_-]+/?$' else false end) then return false;end if;
end loop;return(select count(*)=count(distinct value->>'provider') from jsonb_array_elements(links));end$function$;

CREATE OR REPLACE FUNCTION private.velnu_financial_role_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare workspace_id uuid;
begin
  workspace_id := case when tg_op = 'DELETE' then old.business_id else new.business_id end;
  if (select auth.uid()) is not null
     and not private.has_business_role(workspace_id, array['owner','admin','office'])
  then
    raise exception 'Only an owner, administrator, or office user may change financial records';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.velnu_freeze_document_issuer()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare details jsonb;
begin
  if tg_op = 'INSERT' then
    new.issuer_snapshot := null;
    return new;
  end if;

  -- Clients cannot supply or rewrite a frozen identity on an existing row.
  if new.issuer_snapshot is distinct from old.issuer_snapshot then
    raise exception 'Issued company identity is read only';
  end if;

  if old.status = 'draft' and new.status <> 'draft' then
    select jsonb_build_object(
      'name', b.name,
      'legal_name', b.legal_name,
      'email', b.email,
      'phone', b.phone,
      'website', b.website,
      'address_line1', b.address_line1,
      'address_line2', b.address_line2,
      'city', b.city,
      'state', b.state,
      'postal_code', b.postal_code,
      'logo_path', b.logo_path,
      'document_accent', b.document_accent,
      'document_footer', b.document_footer
    ) into details
    from public.businesses b
    where b.id = new.business_id;

    if details is null then
      raise exception 'Company profile unavailable; cannot issue this document';
    end if;
    new.issuer_snapshot := details;
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.velnu_has_accepted_terms()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select (select auth.uid()) is not null and exists (
    select 1 from public.user_agreement_acceptances a
    where a.user_id=(select auth.uid())
      and a.terms_accepted
      and a.ai_disclosure_acknowledged
      and a.electronic_records_consent
      and a.agreement_version in ('2026-10-26-v1','2026-10-26-v2','2026-10-27-v3')
  );
$function$;

CREATE OR REPLACE FUNCTION private.velnu_membership_role_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare acting_user uuid := (select auth.uid());
declare target_bid uuid;
begin
  target_bid := case when tg_op='DELETE' then old.business_id else new.business_id end;

  if acting_user is null then
    -- Backend service-role maintenance and account deletion remain possible.
    if tg_op='DELETE' then return old; end if;
    return new;
  end if;

  if tg_op='INSERT' and new.role='owner' then
    if not private.has_business_role(target_bid,array['owner']) then
      if new.user_id <> acting_user
        or not exists(
          select 1 from public.businesses b
          where b.id=target_bid and b.created_by_user_id=acting_user
        )
        or exists(
          select 1 from public.business_members m
          where m.business_id=target_bid and m.role='owner'
        )
      then
        raise exception 'Only the business owner may assign an owner role';
      end if;
    end if;
  end if;

  if tg_op='UPDATE' then
    if new.business_id is distinct from old.business_id
      or new.user_id is distinct from old.user_id then
      raise exception 'A business membership cannot be reassigned';
    end if;
    if old.role='owner' and new.role<>'owner' then
      raise exception 'The owner role cannot be removed without a separate ownership transfer';
    end if;
    if old.role<>'owner' and new.role='owner'
      and not private.has_business_role(target_bid,array['owner']) then
      raise exception 'Only the existing owner can grant owner status';
    end if;
  elsif tg_op='DELETE' then
    if old.role='owner' then
      raise exception 'The business owner cannot be deleted without an ownership transfer';
    end if;
    return old;
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.assign_change_order_number()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare n bigint; p text;
begin
  if new.change_order_number is null then
    update public.businesses
      set next_change_order_number=next_change_order_number+1
      where id=new.business_id
      returning next_change_order_number-1,change_order_prefix into n,p;
    new.change_order_number=p||'-'||n::text;
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.assign_estimate_number()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ declare n bigint; p text; begin if new.estimate_number is null then update businesses set next_estimate_number=next_estimate_number+1 where id=new.business_id returning next_estimate_number-1,estimate_prefix into n,p; new.estimate_number=p||'-'||n::text; end if; return new; end $function$;

CREATE OR REPLACE FUNCTION public.assign_invoice_number()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ declare n bigint; p text; begin if new.invoice_number is null then update businesses set next_invoice_number=next_invoice_number+1 where id=new.business_id returning next_invoice_number-1,invoice_prefix into n,p; new.invoice_number=p||'-'||n::text; end if; return new; end $function$;

CREATE OR REPLACE FUNCTION public.bootstrap_business_owner()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ begin if auth.uid() is not null then insert into business_members(business_id,user_id,role) values(new.id,auth.uid(),'owner') on conflict do nothing; end if; return new; end $function$;

CREATE OR REPLACE FUNCTION public.claim_document_email(p_request uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare o private.finviant_email_outbox%rowtype;lease uuid:=gen_random_uuid();begin
 select * into o from private.finviant_email_outbox where id=p_request for update;if not found then raise exception 'SEND_NOT_FOUND' using errcode='P0002';end if;
 if o.status in('accepted','delivered') then return jsonb_build_object('id',o.id,'status',o.status,'provider_id',o.provider_id,'recipient',o.payload->'to'->>0);end if;
 if o.status in('failed','reconciliation_required') then return jsonb_build_object('id',o.id,'status',o.status);end if;
 if not exists(select 1 from public.business_members where business_id=o.business_id and user_id=o.actor_id and role in('owner','admin','office')) then update private.finviant_email_outbox set status='reconciliation_required',last_code='access_revoked' where id=o.id;return jsonb_build_object('id',o.id,'status','reconciliation_required');end if;
 if not exists(select 1 from private.business_entitlements where business_id=o.business_id and plan in('basic','pro') and (valid_until is null or valid_until>now())) then update private.finviant_email_outbox set status='reconciliation_required',last_code='entitlement_expired' where id=o.id;return jsonb_build_object('id',o.id,'status','reconciliation_required');end if; if o.created_at<now()-interval '23 hours' or o.attempts>=5 then update private.finviant_email_outbox set status='reconciliation_required' where id=o.id;return jsonb_build_object('id',o.id,'status','reconciliation_required');end if;
 if (o.lease_until>now()) or o.next_attempt_at>now() then return jsonb_build_object('id',o.id,'status','busy');end if;
 update private.finviant_email_outbox set status='sending',attempts=attempts+1,lease_id=lease,lease_until=now()+interval '2 minutes' where id=o.id;
 return jsonb_build_object('id',o.id,'status','claimed','lease',lease,'payload',o.payload);end;$function$;

CREATE OR REPLACE FUNCTION public.consume_document_approval(p_token_hash text, p_action text, p_typed_name text, p_user_agent text, p_terms_agreed boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  l public.document_approval_links%rowtype;
  existing public.document_approvals%rowtype;
  snap jsonb;
  amount numeric;
  result_id uuid;
begin
  if p_action not in ('approved','declined') then raise exception 'INVALID_ACTION' using errcode='22023'; end if;
  if char_length(btrim(coalesce(p_typed_name,''))) < 2 or char_length(btrim(p_typed_name)) > 200 then raise exception 'INVALID_NAME' using errcode='22023'; end if;

  select * into l from public.document_approval_links where token_hash=p_token_hash for update;
  if not found then raise exception 'LINK_NOT_FOUND' using errcode='P0002'; end if;

  select * into existing from public.document_approvals where approval_link_id=l.id;
  if found then
    return jsonb_build_object('approval_id',existing.id,'action',existing.action,'already_consumed',true,'created_at',existing.created_at,'amount',existing.amount_at_action,'document_type',existing.document_type);
  end if;

  if l.revoked_at is not null then raise exception 'LINK_REVOKED' using errcode='P0001'; end if;
  if l.expires_at <= now() then raise exception 'LINK_EXPIRED' using errcode='P0001'; end if;

  if l.document_type='estimate' then
    select e.total,
      jsonb_build_object(
        'document_type','estimate','id',e.id,'number',e.estimate_number,'status',e.status,'issue_date',e.issue_date,'expires_on',e.expires_on,
        'subtotal',e.subtotal,'tax_amount',e.tax_amount,'total',e.total,'customer_message',e.customer_message,
        'items',coalesce((select jsonb_agg(jsonb_build_object('description',i.description,'quantity',i.quantity,'unit_price',i.unit_price,'tax_rate',i.tax_rate,'line_total',i.line_total) order by i.sort_order) from public.estimate_items i where i.estimate_id=e.id),'[]'::jsonb)
      ) into amount,snap
    from public.estimates e where e.id=l.estimate_id and e.business_id=l.business_id for update;
    if not found then raise exception 'DOCUMENT_NOT_FOUND' using errcode='P0002'; end if;
    if (snap->>'status') <> 'sent' then raise exception 'DOCUMENT_NOT_APPROVABLE' using errcode='P0001'; end if;
    if p_action='approved' and p_terms_agreed is distinct from true then
      raise exception 'TERMS_NOT_ACCEPTED' using errcode='22023';
    end if;
    if p_action='approved' then
      snap:=snap || jsonb_build_object(
        'terms_accepted',true,
        'terms_accepted_at',now(),
        'terms_version','estimate_agreement_2026_10_v1',
        'terms_statement','I have reviewed the estimate, including the scope, prices, taxes, total amount, validity date, and any additional terms shown above. I agree to these terms and authorize the issuing business to proceed with the quoted work.'
      );
    else
      snap:=snap || jsonb_build_object('terms_accepted',false);
    end if;
    update public.estimates set status=case when p_action='approved' then 'accepted' else 'declined' end where id=l.estimate_id;
  else
    select c.total,
      jsonb_build_object(
        'document_type','change_order','id',c.id,'number',c.change_order_number,'status',c.status,'title',c.title,'description',c.description,'reason',c.reason,
        'schedule_impact_days',c.schedule_impact_days,'schedule_note',c.schedule_note,'issue_date',c.issue_date,
        'subtotal',c.subtotal,'tax_amount',c.tax_amount,'total',c.total,'customer_message',c.customer_message,
        'items',coalesce((select jsonb_agg(jsonb_build_object('description',i.description,'quantity',i.quantity,'unit_price',i.unit_price,'tax_rate',i.tax_rate,'line_total',i.line_total) order by i.sort_order) from public.change_order_items i where i.change_order_id=c.id),'[]'::jsonb)
      ) into amount,snap
    from public.change_orders c where c.id=l.change_order_id and c.business_id=l.business_id for update;
    if not found then raise exception 'DOCUMENT_NOT_FOUND' using errcode='P0002'; end if;
    if (snap->>'status') <> 'sent' then raise exception 'DOCUMENT_NOT_APPROVABLE' using errcode='P0001'; end if;
    update public.change_orders set status=case when p_action='approved' then 'approved' else 'declined' end where id=l.change_order_id;
  end if;

  insert into public.document_approvals(approval_link_id,business_id,document_type,estimate_id,change_order_id,action,typed_name,amount_at_action,document_snapshot,user_agent)
  values(l.id,l.business_id,l.document_type,l.estimate_id,l.change_order_id,p_action,btrim(p_typed_name),amount,snap,left(p_user_agent,500))
  returning id into result_id;

  update public.document_approval_links set revoked_at=now() where id=l.id;
  return jsonb_build_object('approval_id',result_id,'action',p_action,'already_consumed',false,'amount',amount,'document_type',l.document_type);
end $function$;

CREATE OR REPLACE FUNCTION public.convert_estimate_to_invoice(target_estimate_id uuid, target_due_date date DEFAULT NULL::date)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$declare e public.estimates%rowtype;i uuid;begin select * into e from public.estimates where id=target_estimate_id for update;if not found or not private.can_write_business(e.business_id) then raise exception 'Estimate unavailable' using errcode='42501';end if;select id into i from public.invoices where estimate_id=e.id;if i is not null then return i;end if;if e.status<>'accepted' then raise exception 'Accept the estimate before converting it' using errcode='23514';end if;if target_due_date is not null and target_due_date<(now() at time zone(select timezone from public.businesses where id=e.business_id))::date then raise exception 'Invoice due date cannot be in the past';end if;if not exists(select 1 from public.estimate_items where estimate_id=e.id and business_id=e.business_id) then raise exception 'Estimate has no line items';end if;insert into public.invoices(business_id,customer_id,job_id,estimate_id,due_date,notes,customer_message,payment_links,payment_instructions) values(e.business_id,e.customer_id,e.job_id,e.id,target_due_date,e.notes,e.customer_message,coalesce((select payment_links from public.business_settings where business_id=e.business_id),'[]'::jsonb),coalesce((select payment_instructions from public.business_settings where business_id=e.business_id),'')) returning id into i;insert into public.invoice_items(invoice_id,business_id,description,quantity,unit_price,tax_rate,sort_order) select i,business_id,description,quantity,unit_price,tax_rate,sort_order from public.estimate_items where estimate_id=e.id and business_id=e.business_id order by sort_order;update public.estimates set status='converted' where id=e.id;return i;end$function$;

CREATE OR REPLACE FUNCTION public.create_change_order_document(target_business_id uuid, request_id uuid, payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$declare r jsonb;cid uuid;x jsonb;k integer:=0;fp text;begin if auth.uid() is null or not private.can_write_business(target_business_id) then raise exception 'Not authorized' using errcode='42501';end if;if request_id is null then raise exception 'Request ID is required';end if;fp:=encode(sha256(convert_to(payload::text,'UTF8')),'hex');perform pg_advisory_xact_lock(hashtextextended(target_business_id::text||request_id::text,0));select to_jsonb(c) into r from public.change_orders c where business_id=target_business_id and c.request_id=create_change_order_document.request_id;if r is not null then if r->>'request_fingerprint'<>fp then raise exception 'This request saved different content. Open the saved change order first.';end if;return r;end if;if jsonb_typeof(payload->'items') is distinct from 'array' or jsonb_array_length(payload->'items') not between 1 and 50 or length(btrim(coalesce(payload->>'title',''))) not between 1 and 200 or pg_column_size(payload)>65536 then raise exception 'Use a title and 1 to 50 line items within the size limit';end if;if abs(coalesce((payload->>'schedule_impact_days')::integer,0))>3650 then raise exception 'Schedule impact is outside the supported range';end if;insert into public.change_orders(business_id,customer_id,job_id,estimate_id,title,description,reason,schedule_impact_days,schedule_note,notes,customer_message,request_id,request_fingerprint,status) values(target_business_id,(payload->>'customer_id')::uuid,(payload->>'job_id')::uuid,nullif(payload->>'estimate_id','')::uuid,btrim(payload->>'title'),payload->>'description',payload->>'reason',coalesce((payload->>'schedule_impact_days')::integer,0),payload->>'schedule_note',payload->>'notes',payload->>'customer_message',request_id,fp,'draft') returning id into cid;for x in select value from jsonb_array_elements(payload->'items') loop insert into public.change_order_items(business_id,change_order_id,description,quantity,unit_price,tax_rate,sort_order) values(target_business_id,cid,btrim(x->>'description'),(x->>'quantity')::numeric,(x->>'unit_price')::numeric,coalesce((x->>'tax_rate')::numeric,0),k);k:=k+1;end loop;select to_jsonb(c) into r from public.change_orders c where id=cid;return r;end$function$;

CREATE OR REPLACE FUNCTION public.create_document(target_business_id uuid, document_kind text, request_id uuid, payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$declare new_id uuid;result jsonb;x jsonb;k integer:=0;customer uuid;dt date;fingerprint text;begin if auth.uid() is null or not private.can_write_business(target_business_id) then raise exception 'Not authorized' using errcode='42501';end if;if document_kind not in('invoice','estimate') or request_id is null then raise exception 'Invalid document request';end if;fingerprint:=encode(sha256(convert_to(payload::text,'UTF8')),'hex');perform pg_advisory_xact_lock(hashtextextended(target_business_id::text||request_id::text,0));if document_kind='invoice' then select to_jsonb(i) into result from public.invoices i where business_id=target_business_id and i.request_id=create_document.request_id;else select to_jsonb(e) into result from public.estimates e where business_id=target_business_id and e.request_id=create_document.request_id;end if;if result is not null then if result->>'request_fingerprint' is distinct from fingerprint then raise exception 'This request already saved different content. Open the saved document before starting another.' using errcode='23505';end if;return result;end if;if jsonb_typeof(payload->'items') is distinct from 'array' or jsonb_array_length(payload->'items') not between 1 and 50 then raise exception 'Add 1 to 50 line items' using errcode='23514';end if;if length(coalesce(payload->>'notes',''))>4000 or length(coalesce(payload->>'customer_message',''))>4000 then raise exception 'Notes must be at most 4000 characters';end if;customer:=(payload->>'customer_id')::uuid;dt:=nullif(coalesce(payload->>'due_date',payload->>'expires_on'),'')::date;if dt is not null and dt<(now() at time zone(select timezone from public.businesses where id=target_business_id))::date then raise exception 'Choose today or a future due/expiration date';end if;if document_kind='invoice' then insert into public.invoices(business_id,customer_id,due_date,notes,customer_message,request_id,request_fingerprint,payment_links,payment_instructions) values(target_business_id,customer,dt,payload->>'notes',payload->>'customer_message',request_id,fingerprint,coalesce((select payment_links from public.business_settings where business_id=target_business_id),'[]'::jsonb),coalesce((select payment_instructions from public.business_settings where business_id=target_business_id),'')) returning id into new_id;else insert into public.estimates(business_id,customer_id,expires_on,notes,customer_message,request_id,request_fingerprint) values(target_business_id,customer,dt,payload->>'notes',payload->>'customer_message',request_id,fingerprint) returning id into new_id;end if;for x in select value from jsonb_array_elements(payload->'items') loop if document_kind='invoice' then insert into public.invoice_items(invoice_id,business_id,description,quantity,unit_price,tax_rate,sort_order) values(new_id,target_business_id,btrim(x->>'description'),(x->>'quantity')::numeric,(x->>'unit_price')::numeric,coalesce((x->>'tax_rate')::numeric,0),k);else insert into public.estimate_items(estimate_id,business_id,description,quantity,unit_price,tax_rate,sort_order) values(new_id,target_business_id,btrim(x->>'description'),(x->>'quantity')::numeric,(x->>'unit_price')::numeric,coalesce((x->>'tax_rate')::numeric,0),k);end if;k:=k+1;end loop;if document_kind='invoice' then select to_jsonb(i) into result from public.invoices i where id=new_id;else select to_jsonb(e) into result from public.estimates e where id=new_id;end if;return result;end$function$;

CREATE OR REPLACE FUNCTION public.create_job_atomic(target_business_id uuid, request_id uuid, payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare old_row public.jobs%rowtype; new_row public.jobs%rowtype; fingerprint text; cid uuid; pid uuid; job_title text;
begin
 if auth.uid() is null or not private.can_write_business(target_business_id) then raise exception 'Write permission required' using errcode='42501'; end if;
 if request_id is null or payload is null or jsonb_typeof(payload)<>'object' then raise exception 'Invalid job request' using errcode='22023'; end if;
 if nullif(payload->>'scheduled_start','') is not null then return public.create_scheduled_job(target_business_id,request_id,payload); end if;
 fingerprint:=encode(sha256(convert_to(payload::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended('velnu-scheduled-job-'||target_business_id::text||request_id::text,0));
 select * into old_row from public.jobs j where j.business_id=target_business_id and j.request_id=create_job_atomic.request_id;
 if found then
   if old_row.request_fingerprint is distinct from fingerprint then raise exception 'Request already saved different content' using errcode='23505'; end if;
   return to_jsonb(old_row);
 end if;
 cid:=nullif(payload->>'customer_id','')::uuid; pid:=nullif(payload->>'property_id','')::uuid;
 job_title:=btrim(coalesce(payload->>'title',''));
 if length(job_title) not between 1 and 200 or length(coalesce(payload->>'description',''))>4000 then raise exception 'Invalid job details' using errcode='22023'; end if;
 if cid is null or not exists(select 1 from public.customers c where c.id=cid and c.business_id=target_business_id and not c.archived) then raise exception 'Customer unavailable' using errcode='23503'; end if;
 if pid is not null and not exists(select 1 from public.properties p where p.id=pid and p.business_id=target_business_id and p.customer_id=cid) then raise exception 'Service location unavailable' using errcode='23503'; end if;
 if nullif(payload->>'scheduled_end','') is not null then raise exception 'A scheduled end requires a start' using errcode='22023'; end if;
 insert into public.jobs(business_id,customer_id,property_id,title,description,status,request_id,request_fingerprint)
 values(target_business_id,cid,pid,job_title,nullif(btrim(payload->>'description'),''),'lead',request_id,fingerprint) returning * into new_row;
 return to_jsonb(new_row);
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_scheduled_job(target_business_id uuid, request_id uuid, payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  existing_row public.jobs%rowtype;
  created_row public.jobs%rowtype;
  customer_uuid uuid;
  property_uuid uuid;
  scheduled_from timestamptz;
  scheduled_until timestamptz;
  job_title text;
  job_description text;
  fingerprint text;
  appointment_uuid uuid;
begin
  if (select auth.uid()) is null or not private.can_write_business(target_business_id) then
    raise exception 'Not authorized to schedule work' using errcode='42501';
  end if;
  if request_id is null or payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception 'Invalid scheduled job request' using errcode='22023';
  end if;

  fingerprint := encode(sha256(convert_to(payload::text, 'UTF8')), 'hex');
  perform pg_advisory_xact_lock(hashtextextended(
    'velnu-scheduled-job-' || target_business_id::text || request_id::text, 0
  ));
  select * into existing_row from public.jobs
  where business_id=target_business_id and jobs.request_id=create_scheduled_job.request_id;
  if found then
    if existing_row.request_fingerprint is distinct from fingerprint then
      raise exception 'This scheduling request already saved different content'
        using errcode='23505';
    end if;
    select a.id into appointment_uuid from public.appointments a
      where a.business_id=target_business_id and a.job_id=existing_row.id limit 1;
    if appointment_uuid is null then
      raise exception 'Saved scheduling request has no appointment; contact support'
        using errcode='23514';
    end if;
    return to_jsonb(existing_row) || jsonb_build_object('appointment_id', appointment_uuid);
  end if;

  job_title := btrim(coalesce(payload->>'title', ''));
  if length(job_title) < 1 or length(job_title) > 200 then
    raise exception 'Job title must be 1 to 200 characters' using errcode='23514';
  end if;
  job_description := nullif(btrim(coalesce(payload->>'description', '')), '');
  customer_uuid := nullif(payload->>'customer_id', '')::uuid;
  property_uuid := nullif(payload->>'property_id', '')::uuid;
  scheduled_from := nullif(payload->>'scheduled_start', '')::timestamptz;
  scheduled_until := nullif(payload->>'scheduled_end', '')::timestamptz;
  if customer_uuid is null or not exists (
    select 1 from public.customers c
    where c.id=customer_uuid and c.business_id=target_business_id
  ) then
    raise exception 'Choose a customer belonging to this business' using errcode='23503';
  end if;
  if property_uuid is not null and not exists (
    select 1 from public.properties p
    where p.id=property_uuid and p.customer_id=customer_uuid and p.business_id=target_business_id
  ) then
    raise exception 'Choose a service location belonging to this customer' using errcode='23503';
  end if;
  if scheduled_from is null or
    (scheduled_until is not null and scheduled_until <= scheduled_from) then
    raise exception 'End time must be after the start time' using errcode='23514';
  end if;

  insert into public.jobs (
    business_id, customer_id, property_id, title, description, status,
    scheduled_start, scheduled_end, request_id, request_fingerprint
  ) values (
    target_business_id, customer_uuid, property_uuid, job_title, job_description, 'scheduled',
    scheduled_from, scheduled_until, request_id, fingerprint
  ) returning * into created_row;

  insert into public.appointments (
    business_id, customer_id, job_id, title, starts_at, ends_at, status
  ) values (
    target_business_id, customer_uuid, created_row.id, job_title,
    scheduled_from, scheduled_until, 'scheduled'
  ) returning id into appointment_uuid;

  return to_jsonb(created_row) || jsonb_build_object('appointment_id', appointment_uuid);
end;
$function$;

CREATE OR REPLACE FUNCTION public.decide_ai_action(p_action_id uuid, p_decision text)
 RETURNS void
 LANGUAGE sql
 SET search_path TO ''
AS $function$ select private.finviant_ai_decision(p_action_id,p_decision); $function$;

CREATE OR REPLACE FUNCTION public.execute_ai_mutation(p_action_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare target_business uuid; target_intent text; actor_role text;
begin
  if auth.uid() is null or p_action_id is null then raise exception 'Sign in required' using errcode='42501'; end if;
  select a.business_id,a.intent into target_business,target_intent from public.ai_actions a
    where a.id=p_action_id and a.user_id=auth.uid();
  if target_business is null or not private.can_write_business(target_business) then
    raise exception 'Business access denied' using errcode='42501'; end if;
  select bm.role into actor_role from public.business_members bm
    where bm.business_id=target_business and bm.user_id=auth.uid() for share;
  if actor_role is null or (target_intent in ('create_invoice','create_estimate','record_payment','create_change_order')
    and actor_role not in ('owner','admin','office')) then
    raise exception 'Business access denied' using errcode='42501'; end if;
  return private.finviant_execute_ai_mutation(p_action_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.execute_confirmed_action(target_action_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$select private.execute_confirmed_action(target_action_id)$function$;

CREATE OR REPLACE FUNCTION public.finish_document_email(p_request uuid, p_lease uuid, p_result text, p_provider_id text DEFAULT NULL::text, p_code text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare o private.finviant_email_outbox%rowtype;e record;begin
 select * into o from private.finviant_email_outbox where id=p_request for update;if not found then raise exception 'SEND_NOT_FOUND' using errcode='P0002';end if;
 if o.status in('accepted','delivered') then return;end if;
 if o.lease_id is distinct from p_lease or p_lease is null then raise exception 'STALE_SEND_LEASE' using errcode='23514';end if;
 if p_result is null or p_result not in('accepted','uncertain','failed') then raise exception 'INVALID_RESULT' using errcode='22023';end if;
 if p_result='accepted' and (p_provider_id is null or length(p_provider_id)<1 or length(p_provider_id)>200) then raise exception 'INVALID_PROVIDER_ID' using errcode='22023';end if;
 update private.finviant_email_outbox set status=p_result,provider_id=p_provider_id,lease_id=null,lease_until=null,last_code=left(p_code,80),next_attempt_at=now()+interval '30 seconds'*power(2,least(o.attempts,5)) where id=o.id;
 update public.messages set status=case when p_result='accepted' then 'sent' when p_result='failed' then 'failed' else 'queued' end,provider_message_id=p_provider_id,sent_at=case when p_result='accepted' then now() else sent_at end where id=o.id and business_id=o.business_id;
 if p_result='accepted' then select * into e from private.finviant_delivery_events where provider_id=p_provider_id and event_type in ('email.delivered','email.bounced','email.complained','email.failed','email.suppressed') order by occurred_at desc,event_id desc limit 1;
  if found and e.event_type in('email.delivered','email.bounced','email.complained','email.failed','email.suppressed') then update private.finviant_email_outbox set status=case when e.event_type='email.delivered' then 'delivered' else 'failed' end,last_event_at=e.occurred_at where id=o.id;update public.messages set status=case when e.event_type='email.delivered' then 'delivered' else 'failed' end where id=o.id and business_id=o.business_id;end if;
 end if;end;$function$;

CREATE OR REPLACE FUNCTION public.finviant_ops_health()
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select jsonb_build_object('database','reachable','checked_at',now(),
 'email_queued',(select count(*) from private.finviant_email_outbox where status='queued'),
 'email_uncertain',(select count(*) from private.finviant_email_outbox where status in('uncertain','reconciliation_required')),
 'email_stale',(select count(*) from private.finviant_email_outbox where status in('queued','sending','uncertain') and created_at<now()-interval '30 minutes'),
 'sandbox_events_awaiting_reconciliation',(select count(*) from private.finviant_payment_events where state='awaiting_reconciliation'),
 'failed_email_last_day',(select count(*) from private.finviant_email_outbox where status='failed' and created_at>now()-interval '1 day'));
$function$;

CREATE OR REPLACE FUNCTION public.get_dashboard_invoice_totals(target_business_id uuid)
 RETURNS TABLE(open_invoices bigint, outstanding_balance numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select count(*)::bigint, coalesce(sum(i.balance_due), 0)::numeric
  from public.invoices as i
  where i.business_id = target_business_id
    and i.balance_due > 0
    and i.status not in ('draft', 'void');
$function$;

CREATE OR REPLACE FUNCTION public.get_dashboard_metrics(target_business_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$declare today date;month_start timestamptz;zone text;r jsonb;begin if auth.uid() is null or not private.is_business_member(target_business_id) then raise exception 'Not authorized' using errcode='42501';end if;select timezone into zone from public.businesses where id=target_business_id;today:=(now() at time zone zone)::date;month_start:=date_trunc('month',now() at time zone zone) at time zone zone;select jsonb_build_object('today',today,'timezone',zone,'outstanding',coalesce(sum(balance_due) filter(where status not in('draft','void') and balance_due>0),0),'open_count',count(*) filter(where status not in('draft','void') and balance_due>0),'overdue',coalesce(sum(balance_due) filter(where status not in('draft','void') and due_date<today and balance_due>0),0),'overdue_count',count(*) filter(where status not in('draft','void') and due_date<today and balance_due>0),'draft_count',count(*) filter(where status='draft'),'aging',jsonb_build_object('current',coalesce(sum(balance_due) filter(where status not in('draft','void') and(due_date is null or due_date>=today)),0),'days_1_30',coalesce(sum(balance_due) filter(where status not in('draft','void') and today-due_date between 1 and 30),0),'days_31_60',coalesce(sum(balance_due) filter(where status not in('draft','void') and today-due_date between 31 and 60),0),'days_61_90',coalesce(sum(balance_due) filter(where status not in('draft','void') and today-due_date between 61 and 90),0),'days_90_plus',coalesce(sum(balance_due) filter(where status not in('draft','void') and today-due_date>90),0))) into r from public.invoices where business_id=target_business_id;return r||jsonb_build_object('collected_month',coalesce((select sum(amount) from public.payments where business_id=target_business_id and status='succeeded' and paid_at>=month_start and paid_at<=now()),0),'customer_count',(select count(*) from public.customers where business_id=target_business_id and not archived),'awaiting_estimates',(select count(*) from public.estimates where business_id=target_business_id and status='sent' and(expires_on is null or expires_on>=today)),'accepted_estimates',(select count(*) from public.estimates where business_id=target_business_id and status='accepted'),'failed_emails',(select count(*) from public.messages where business_id=target_business_id and channel='email' and status='failed' and created_at>=month_start));end$function$;

CREATE OR REPLACE FUNCTION public.get_plan_usage(target_business_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$select private.get_plan_usage(target_business_id)$function$;

CREATE OR REPLACE FUNCTION public.list_due_document_emails()
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select coalesce(jsonb_agg(jsonb_build_object('id',q.id)),'[]'::jsonb) from (
 select id from private.finviant_email_outbox where status in('queued','sending','uncertain') and next_attempt_at<=now() and (lease_until is null or lease_until<=now()) order by next_attempt_at,created_at limit 5
 ) q;
$function$;

CREATE OR REPLACE FUNCTION public.prepare_document_email(p_actor uuid, p_business uuid, p_kind text, p_document uuid, p_request uuid, p_origin text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare o private.finviant_email_outbox%rowtype;d jsonb;b record;c record;items_text text;body_text text;subj text;label text;number text;tok text;approval_url text;plan_name text;new_payload jsonb;
begin
 if p_actor is null or p_request is null or p_document is null or p_kind is null or p_kind not in('invoice','estimate','change_order') then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 if p_origin is null or p_origin not in('https://finviant.com','https://www.finviant.com','https://app.finviant.com') then raise exception 'INVALID_APP_ORIGIN' using errcode='22023';end if;
 if not exists(select 1 from public.business_members where business_id=p_business and user_id=p_actor and role in('owner','admin','office')) or not exists(select 1 from public.user_agreement_acceptances where user_id=p_actor and terms_accepted and ai_disclosure_acknowledged and electronic_records_consent) then raise exception 'ACCESS_DENIED' using errcode='42501';end if;
 select plan into plan_name from private.business_entitlements where business_id=p_business and (valid_until is null or valid_until>now());
 if plan_name is null or plan_name not in('basic','pro') or (p_kind<>'invoice' and plan_name<>'pro') then raise exception 'PAID_FEATURE_REQUIRED' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('finviant-email:'||p_business::text,0));
 select * into o from private.finviant_email_outbox where id=p_request;
 if found then if o.business_id<>p_business or o.document_kind<>p_kind or o.document_id<>p_document then raise exception 'REQUEST_CONFLICT' using errcode='23505';end if;return jsonb_build_object('id',o.id,'status',o.status);end if;
 select * into o from private.finviant_email_outbox where business_id=p_business and document_kind=p_kind and document_id=p_document and status in('queued','sending','uncertain','reconciliation_required') order by created_at desc limit 1;
 if found then return jsonb_build_object('id',o.id,'status',o.status);end if;
 if (select count(*) from private.finviant_email_outbox where business_id=p_business and created_at>now()-interval '1 hour')>=100 then raise exception 'EMAIL_RATE_LIMIT' using errcode='P0001';end if;
 select name,email,phone,currency into b from public.businesses where id=p_business;if not found then raise exception 'BUSINESS_NOT_FOUND' using errcode='P0002';end if;
 if p_kind='invoice' then
  select jsonb_build_object('customer_id',customer_id,'number',invoice_number,'status',status,'total',total,'amount_paid',amount_paid,'balance_due',balance_due,'issue_date',issue_date,'due_date',due_date,'customer_message',customer_message,'issuer_snapshot',issuer_snapshot) into d from public.invoices where id=p_document and business_id=p_business for update;
  select string_agg(description||' | Qty '||quantity::text||' x '||unit_price::text||' | Tax '||tax_rate::text||'%',E'\n' order by sort_order,id) into items_text from public.invoice_items where invoice_id=p_document and business_id=p_business;label:='Invoice';
 elsif p_kind='estimate' then
  select jsonb_build_object('customer_id',customer_id,'number',estimate_number,'status',status,'total',total,'issue_date',issue_date,'customer_message',customer_message,'issuer_snapshot',issuer_snapshot) into d from public.estimates where id=p_document and business_id=p_business for update;
  select string_agg(description||' | Qty '||quantity::text||' x '||unit_price::text||' | Tax '||tax_rate::text||'%',E'\n' order by sort_order,id) into items_text from public.estimate_items where estimate_id=p_document and business_id=p_business;label:='Estimate';
 else
  select jsonb_build_object('customer_id',customer_id,'number',change_order_number,'status',status,'total',total,'issue_date',issue_date,'customer_message',customer_message,'title',title,'schedule_impact_days',schedule_impact_days,'issuer_snapshot',issuer_snapshot) into d from public.change_orders where id=p_document and business_id=p_business for update;
  select string_agg(description||' | Qty '||quantity::text||' x '||unit_price::text||' | Tax '||tax_rate::text||'%',E'\n' order by sort_order,id) into items_text from public.change_order_items where change_order_id=p_document and business_id=p_business;label:='Change order';
 end if;
 if d is null then raise exception 'DOCUMENT_NOT_FOUND' using errcode='P0002';end if;
 if d->>'status' in('void','converted','expired','declined','accepted','approved') then raise exception 'DOCUMENT_NOT_SENDABLE' using errcode='23514';end if;
 if items_text is null then raise exception 'LINE_ITEMS_REQUIRED' using errcode='23514';end if;
 select id,first_name,last_name,company,email into c from public.customers where id=(d->>'customer_id')::uuid and business_id=p_business;
 if not found or c.email is null or c.email !~ '^[^[:space:]<>@]+@[^[:space:]<>@]+\.[^[:space:]<>@]+$' then raise exception 'VALID_RECIPIENT_REQUIRED' using errcode='23514';end if;
 if jsonb_typeof(d->'issuer_snapshot')='object' then b.name:=coalesce(d#>>'{issuer_snapshot,name}',b.name);b.email:=d#>>'{issuer_snapshot,email}';b.phone:=d#>>'{issuer_snapshot,phone}';end if;number:=coalesce(d->>'number',label);subj:=regexp_replace(b.name||': '||label||' '||number,E'[\r\n]',' ','g');
 body_text:=b.name||E'\n'||label||' '||number||E'\n\nHello '||coalesce(nullif(btrim(concat_ws(' ',c.first_name,c.last_name)),''),c.company,'Customer')||E',\n\n'||coalesce(d->>'title','')||E'\n'||items_text||E'\n\nTotal: '||coalesce(b.currency,'USD')||' '||(d->>'total')||E'\n'||coalesce(d->>'customer_message','');
 if p_kind='invoice' then
  body_text:=body_text||E'\nPaid: '||coalesce(d->>'amount_paid','0')||E'\nBalance due: '||coalesce(d->>'balance_due','0')||E'\nDue date: '||coalesce(d->>'due_date','Contact the business')||E'\nContact the business directly for payment arrangements.';
  update public.invoices set status='sent',sent_at=coalesce(sent_at,now()) where id=p_document and business_id=p_business and status='draft';
 else
  tok:=encode(extensions.gen_random_bytes(32),'hex');approval_url:=p_origin||'/?approval='||tok;
  insert into public.document_approval_links(business_id,document_type,estimate_id,change_order_id,token_hash,expires_at,created_by_user_id) values(p_business,p_kind,case when p_kind='estimate' then p_document end,case when p_kind='change_order' then p_document end,encode(sha256(convert_to(tok,'UTF8')),'hex'),now()+interval '14 days',p_actor);
  body_text:=body_text||E'\n\nReview the scope, amount and terms: '||approval_url||E'\nThis private review link expires in 14 days.';
  if p_kind='estimate' then update public.estimates set status='sent' where id=p_document and business_id=p_business and status='draft';else update public.change_orders set status='sent',sent_at=coalesce(sent_at,now()) where id=p_document and business_id=p_business and status='draft';end if;
 end if;
 new_payload:=jsonb_build_object('from','Finviant Office <adminsupport@finviant.com>','to',jsonb_build_array(btrim(c.email)),'subject',subj,'text',body_text,'tags',jsonb_build_array(jsonb_build_object('name','finviant_request_id','value',p_request::text)));
 if b.email is not null and b.email ~ '^[^[:space:]<>@]+@[^[:space:]<>@]+\.[^[:space:]<>@]+$' then new_payload:=new_payload||jsonb_build_object('reply_to',jsonb_build_array(b.email));end if;
 insert into public.messages(id,business_id,customer_id,invoice_id,estimate_id,change_order_id,direction,channel,recipient,subject,body,provider,status) values(p_request,p_business,c.id,case when p_kind='invoice' then p_document end,case when p_kind='estimate' then p_document end,case when p_kind='change_order' then p_document end,'outbound','email',c.email,subj,body_text,'resend','queued');
 insert into private.finviant_email_outbox(id,business_id,actor_id,document_kind,document_id,payload) values(p_request,p_business,p_actor,p_kind,p_document,new_payload);
 return jsonb_build_object('id',p_request,'status','queued');
end;$function$;

CREATE OR REPLACE FUNCTION public.prevent_invoice_overpayment()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  invoice_total numeric;
  existing_paid numeric;
begin
  if new.status <> 'succeeded' then
    return new;
  end if;

  select total into invoice_total
  from public.invoices
  where id = new.invoice_id and business_id = new.business_id
  for update;

  if invoice_total is null then
    return new;
  end if;

  select coalesce(sum(amount),0) into existing_paid
  from public.payments
  where invoice_id = new.invoice_id
    and business_id = new.business_id
    and status = 'succeeded'
    and (tg_op = 'INSERT' or id <> new.id);

  if existing_paid + new.amount > invoice_total then
    raise exception 'Payment would overpay invoice: total %, already paid %, new payment %', invoice_total, existing_paid, new.amount
      using errcode = '23514';
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.recalc_change_order()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare cid uuid;
begin
  cid:=coalesce(new.change_order_id,old.change_order_id);
  update public.change_orders c set
    subtotal=coalesce((select sum(line_total) from public.change_order_items where change_order_id=cid),0),
    tax_amount=coalesce((select sum(round(line_total*tax_rate/100,2)) from public.change_order_items where change_order_id=cid),0),
    total=coalesce((select sum(line_total+round(line_total*tax_rate/100,2)) from public.change_order_items where change_order_id=cid),0)
  where id=cid;
  return coalesce(new,old);
end $function$;

CREATE OR REPLACE FUNCTION public.recalc_estimate()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ declare eid uuid; begin eid:=coalesce(new.estimate_id,old.estimate_id); update estimates e set subtotal=coalesce((select sum(line_total) from estimate_items where estimate_id=eid),0),tax_amount=coalesce((select sum(round(line_total*tax_rate/100,2)) from estimate_items where estimate_id=eid),0),total=coalesce((select sum(line_total+round(line_total*tax_rate/100,2)) from estimate_items where estimate_id=eid),0) where id=eid; return coalesce(new,old); end $function$;

CREATE OR REPLACE FUNCTION public.recalc_invoice()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ declare iid uuid; begin iid:=coalesce(new.invoice_id,old.invoice_id); update invoices i set subtotal=coalesce((select sum(line_total) from invoice_items where invoice_id=iid),0),tax_amount=coalesce((select sum(round(line_total*tax_rate/100,2)) from invoice_items where invoice_id=iid),0),total=coalesce((select sum(line_total+round(line_total*tax_rate/100,2)) from invoice_items where invoice_id=iid),0) where id=iid; return coalesce(new,old); end $function$;

CREATE OR REPLACE FUNCTION public.recalc_invoice_payments()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ declare iid uuid; declare paid numeric; begin iid:=coalesce(new.invoice_id,old.invoice_id); select coalesce(sum(amount),0) into paid from payments where invoice_id=iid and status in ('succeeded','partially_refunded'); update invoices set amount_paid=paid,status=case when total>0 and paid>=total then 'paid' when paid>0 then 'partial' else case when status in ('paid','partial') then 'sent' else status end end,paid_at=case when total>0 and paid>=total then coalesce(paid_at,now()) else null end where id=iid; return coalesce(new,old); end $function$;

CREATE OR REPLACE FUNCTION public.record_delivery_event(p_event_id text, p_provider_id text, p_type text, p_occurred timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare inserted boolean;o private.finviant_email_outbox%rowtype;new_status text;begin
 if p_event_id is null or p_provider_id is null or p_type is null or length(p_event_id)>200 or length(p_provider_id)>200 or p_type not in('email.sent','email.delivered','email.bounced','email.complained','email.failed','email.suppressed','email.delivery_delayed') or p_occurred is null then raise exception 'INVALID_EVENT' using errcode='22023';end if;
 insert into private.finviant_delivery_events values(p_event_id,p_provider_id,p_type,p_occurred,now()) on conflict do nothing;inserted:=found;if not inserted then return jsonb_build_object('duplicate',true);end if;
 select * into o from private.finviant_email_outbox where provider_id=p_provider_id for update;if not found then return jsonb_build_object('stored',true,'awaiting_acknowledgement',true);end if;
 if o.last_event_at is not null and p_occurred<=o.last_event_at then return jsonb_build_object('stored',true,'stale',true);end if;
 new_status:=case when p_type='email.delivered' then 'delivered' when p_type in('email.bounced','email.complained','email.failed','email.suppressed') then 'failed' else null end;
 if new_status is not null then update private.finviant_email_outbox set status=new_status,last_event_at=p_occurred where id=o.id;update public.messages set status=new_status where id=o.id and business_id=o.business_id;end if;
 return jsonb_build_object('stored',true);end;$function$;

CREATE OR REPLACE FUNCTION public.record_manual_payment(target_business_id uuid, invoice_id uuid, request_id uuid, payment_amount numeric, payment_method text, payment_note text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$declare inv public.invoices%rowtype;old_payment public.payments%rowtype;r jsonb;begin if auth.uid() is null or not private.can_write_business(target_business_id) then raise exception 'Not authorized' using errcode='42501';end if;if request_id is null or payment_amount<=0 or payment_amount>1000000000 or payment_amount<>round(payment_amount,2) or payment_method not in('cash','check','card','ach','other') or length(coalesce(payment_note,''))>2000 then raise exception 'Invalid payment; use a positive amount with two decimal places';end if;perform pg_advisory_xact_lock(hashtextextended(target_business_id::text||request_id::text,0));select * into old_payment from public.payments p where business_id=target_business_id and p.request_id=record_manual_payment.request_id;if found then if old_payment.invoice_id<>invoice_id or old_payment.amount<>payment_amount or old_payment.method<>payment_method then raise exception 'This retry does not match the original payment';end if;return to_jsonb(old_payment);end if;select * into inv from public.invoices i where i.id=record_manual_payment.invoice_id and business_id=target_business_id for update;if not found then raise exception 'Invoice not found';end if;if inv.status in('draft','void') then raise exception 'Issue the invoice before recording a payment; void invoices cannot be paid';end if;if payment_amount>inv.balance_due then raise exception 'Payment exceeds the remaining balance';end if;insert into public.payments(business_id,invoice_id,request_id,amount,method,status,provider,notes) values(target_business_id,invoice_id,request_id,payment_amount,payment_method,'succeeded','manual',payment_note) returning to_jsonb(payments) into r;return r;end$function$;

CREATE OR REPLACE FUNCTION public.record_sandbox_payment_event(p_event_id text, p_account_id text, p_object_id text, p_type text, p_created timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare inserted boolean;existing private.finviant_payment_events%rowtype;
begin
if p_event_id is null or p_event_id !~ '^evt_[A-Za-z0-9]+$' or length(p_event_id)>200 or p_account_id is null or p_account_id !~ '^acct_[A-Za-z0-9]+$' or p_object_id is null or length(p_object_id)>200 or p_type is null or length(p_type)>100 or p_created is null then raise exception 'INVALID_PAYMENT_EVENT' using errcode='22023';end if;
insert into private.finviant_payment_events(event_id,account_id,object_id,event_type,provider_created_at,livemode) values(p_event_id,p_account_id,p_object_id,p_type,p_created,false) on conflict do nothing;inserted:=found;
if not inserted then
select * into existing from private.finviant_payment_events where event_id=p_event_id;
if existing.account_id<>p_account_id or existing.object_id<>p_object_id or existing.event_type<>p_type then raise exception 'PAYMENT_EVENT_COLLISION' using errcode='23505';end if;end if;
return jsonb_build_object('stored',true,'duplicate',not inserted,'state','awaiting_reconciliation');
end;$function$;

CREATE OR REPLACE FUNCTION public.record_tagged_delivery_event(p_event_id text, p_provider_id text, p_type text, p_occurred timestamp with time zone, p_request uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare o private.finviant_email_outbox%rowtype;
begin
if p_request is not null then
 select * into o from private.finviant_email_outbox where id=p_request for update;
 if found and o.attempts>0 and (o.provider_id is null or o.provider_id=p_provider_id)
 and exists(select 1 from jsonb_array_elements(o.payload->'tags') t where t->>'name'='finviant_request_id' and t->>'value'=p_request::text) then
  update private.finviant_email_outbox set provider_id=p_provider_id,status=case when p_type='email.sent' and status in('sending','uncertain','reconciliation_required','queued') then 'accepted' else status end where id=o.id;
  update public.messages set provider_message_id=p_provider_id,status=case when p_type='email.sent' and status='queued' then 'sent' else status end,sent_at=case when p_type='email.sent' then coalesce(sent_at,now()) else sent_at end where id=o.id and business_id=o.business_id;
 end if;
end if;
return public.record_delivery_event(p_event_id,p_provider_id,p_type,p_occurred);
end;$function$;

CREATE OR REPLACE FUNCTION public.reserve_ai_provider_attempt(p_business_id uuid, p_kind text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$ select private.finviant_reserve_ai_attempt(p_business_id,p_kind); $function$;

CREATE OR REPLACE FUNCTION public.reserve_feature(target_business_id uuid, target_user_id uuid, feature text, request_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare m date:=date_trunc('month',now() at time zone 'UTC')::date;used integer;lim integer;
begin
if auth.role() is distinct from 'service_role' then raise exception 'Server authorization required' using errcode='42501';end if;
if not exists(select 1 from public.business_members where business_id=target_business_id and user_id=target_user_id and role in('owner','admin','office','technician')) then raise exception 'Not authorized' using errcode='42501';end if;
if not private.is_pro(target_business_id) then raise exception 'Pro is required for this feature' using errcode='42501';end if;
if feature not in('ai','voice','email') or request_id is null then raise exception 'Invalid feature request' using errcode='22023';end if;
insert into private.monthly_usage(business_id,month) values(target_business_id,m) on conflict do nothing;
perform 1 from private.monthly_usage where business_id=target_business_id and month=m for update;
if exists(select 1 from private.feature_requests r where r.business_id=target_business_id and r.feature=reserve_feature.feature and r.request_id=reserve_feature.request_id) then if feature='email' then return false;end if;raise exception 'This AI request has already been used; refresh the result rather than repeating it' using errcode='23505';end if;
select case feature when 'ai' then ai when 'voice' then voice else email end into used from private.monthly_usage where business_id=target_business_id and month=m;
lim:=case when feature='email' then 250 else 50 end;
if used>=lim then raise exception 'Monthly % limit reached (%). Resets next UTC calendar month.',feature,lim using errcode='P0001';end if;
insert into private.feature_requests(business_id,feature,request_id) values(target_business_id,feature,request_id);
update private.monthly_usage set ai=ai+case when feature='ai' then 1 else 0 end,voice=voice+case when feature='voice' then 1 else 0 end,email=email+case when feature='email' then 1 else 0 end where business_id=target_business_id and month=m;
return true;
end$function$;

CREATE OR REPLACE FUNCTION public.set_change_order_status_timestamps()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if new.status is distinct from old.status then
    if new.status='sent' and new.sent_at is null then new.sent_at=now(); end if;
    if new.status='approved' and new.approved_at is null then new.approved_at=now(); end if;
    if new.status='declined' and new.declined_at is null then new.declined_at=now(); end if;
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.set_job_status_atomic(p_job_id uuid, p_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare j public.jobs%rowtype;
begin
  if auth.uid() is null then raise exception 'Sign in required' using errcode='42501'; end if;
  if p_job_id is null or p_status is null or p_status not in ('lead','scheduled','in_progress','completed','canceled') then
    raise exception 'Invalid job status' using errcode='22023'; end if;
  select * into j from public.jobs where id=p_job_id for update;
  if not found then raise exception 'Job not found or not accessible' using errcode='P0002'; end if;
  if not private.can_write_business(j.business_id) then raise exception 'Write permission required' using errcode='42501'; end if;
  update public.jobs set status=p_status,
    completed_at=case when p_status='completed' then coalesce(j.completed_at,now()) else null end
    where id=j.id returning * into j;
  return jsonb_build_object('id',j.id,'status',j.status,'completed_at',j.completed_at);
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$ begin new.updated_at=now(); return new; end $function$;

CREATE OR REPLACE FUNCTION public.update_draft_document(target_business_id uuid, document_kind text, document_id uuid, expected_updated_at timestamp with time zone, payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$declare d jsonb;t text;it text;fk text;x jsonb;k integer:=0;result jsonb;dt date;begin if auth.uid() is null or not private.can_write_business(target_business_id) then raise exception 'Not authorized' using errcode='42501';end if;if document_kind not in('invoice','estimate') then raise exception 'Invalid document type';end if;t:=case when document_kind='invoice' then 'invoices' else 'estimates' end;it:=case when document_kind='invoice' then 'invoice_items' else 'estimate_items' end;fk:=document_kind||'_id';execute format('select to_jsonb(d) from public.%I d where id=$1 and business_id=$2 for update',t) into d using document_id,target_business_id;if d is null or d->>'status'<>'draft' then raise exception 'Only an available draft can be edited';end if;if expected_updated_at is null or(d->>'updated_at')::timestamptz<>expected_updated_at then raise exception 'This draft changed in another session. Reload it before saving.' using errcode='40001';end if;if jsonb_typeof(payload->'items') is distinct from 'array' or jsonb_array_length(payload->'items') not between 1 and 50 then raise exception 'Add 1 to 50 line items';end if;if length(coalesce(payload->>'notes',''))>4000 or length(coalesce(payload->>'customer_message',''))>4000 then raise exception 'Notes must be at most 4000 characters';end if;dt:=nullif(coalesce(payload->>'due_date',payload->>'expires_on'),'')::date;if dt is not null and dt<(now() at time zone(select timezone from public.businesses where id=target_business_id))::date then raise exception 'Use today or a future due date';end if;execute format('update public.%I set customer_id=$1,%I=$2,notes=$3,customer_message=$4 where id=$5 and business_id=$6',t,case when document_kind='invoice' then 'due_date' else 'expires_on' end) using(payload->>'customer_id')::uuid,dt,payload->>'notes',payload->>'customer_message',document_id,target_business_id;execute format('delete from public.%I where %I=$1 and business_id=$2',it,fk) using document_id,target_business_id;for x in select value from jsonb_array_elements(payload->'items') loop execute format('insert into public.%I(%I,business_id,description,quantity,unit_price,tax_rate,sort_order) values($1,$2,$3,$4,$5,$6,$7)',it,fk) using document_id,target_business_id,btrim(x->>'description'),(x->>'quantity')::numeric,(x->>'unit_price')::numeric,coalesce((x->>'tax_rate')::numeric,0),k;k:=k+1;end loop;execute format('select to_jsonb(d) from public.%I d where id=$1',t) into result using document_id;return result;end$function$;

alter table "private"."business_entitlements" add constraint "business_entitlements_pkey" PRIMARY KEY (business_id);

alter table "private"."business_entitlements" add constraint "business_entitlements_plan_check" CHECK ((plan = ANY (ARRAY['free'::text, 'pro'::text])));

alter table "private"."feature_requests" add constraint "feature_requests_pkey" PRIMARY KEY (business_id, feature, request_id);

alter table "private"."finviant_ai_attempt_budget" add constraint "finviant_ai_attempt_budget_attempts_check" CHECK ((attempts >= 0));

alter table "private"."finviant_ai_attempt_budget" add constraint "finviant_ai_attempt_budget_kind_check" CHECK ((kind = ANY (ARRAY['command'::text, 'transcription'::text])));

alter table "private"."finviant_ai_attempt_budget" add constraint "finviant_ai_attempt_budget_minute_attempts_check" CHECK ((minute_attempts >= 0));

alter table "private"."finviant_ai_attempt_budget" add constraint "finviant_ai_attempt_budget_pkey" PRIMARY KEY (business_id, period, kind);

alter table "private"."finviant_delivery_events" add constraint "finviant_delivery_events_pkey" PRIMARY KEY (event_id);

alter table "private"."finviant_email_outbox" add constraint "finviant_email_outbox_document_kind_check" CHECK ((document_kind = ANY (ARRAY['invoice'::text, 'estimate'::text, 'change_order'::text])));

alter table "private"."finviant_email_outbox" add constraint "finviant_email_outbox_pkey" PRIMARY KEY (id);

alter table "private"."finviant_email_outbox" add constraint "finviant_email_outbox_provider_id_key" UNIQUE (provider_id);

alter table "private"."finviant_email_outbox" add constraint "finviant_email_outbox_status_check" CHECK ((status = ANY (ARRAY['queued'::text, 'sending'::text, 'uncertain'::text, 'accepted'::text, 'delivered'::text, 'failed'::text, 'reconciliation_required'::text])));

alter table "private"."finviant_payment_events" add constraint "finviant_payment_events_livemode_check" CHECK ((livemode = false));

alter table "private"."finviant_payment_events" add constraint "finviant_payment_events_pkey" PRIMARY KEY (event_id);

alter table "private"."finviant_payment_events" add constraint "finviant_payment_events_state_check" CHECK ((state = ANY (ARRAY['awaiting_reconciliation'::text, 'reconciled'::text, 'quarantined'::text])));

alter table "private"."monthly_usage" add constraint "monthly_usage_invoice_estimate_documents_check" CHECK ((invoice_estimate_documents >= 0));

alter table "private"."monthly_usage" add constraint "monthly_usage_pkey" PRIMARY KEY (business_id, month);

alter table "public"."ai_actions" add constraint "ai_actions_pkey" PRIMARY KEY (id);

alter table "public"."ai_actions" add constraint "ai_actions_source_check" CHECK ((source = ANY (ARRAY['text'::text, 'voice'::text, 'system'::text])));

alter table "public"."ai_actions" add constraint "ai_actions_status_check" CHECK ((status = ANY (ARRAY['proposed'::text, 'confirmed'::text, 'executed'::text, 'rejected'::text, 'failed'::text])));

alter table "public"."appointments" add constraint "appointments_end_after_start_check" CHECK (((ends_at IS NULL) OR (ends_at > starts_at)));

alter table "public"."appointments" add constraint "appointments_pkey" PRIMARY KEY (id);

alter table "public"."appointments" add constraint "appointments_status_check" CHECK ((status = ANY (ARRAY['scheduled'::text, 'confirmed'::text, 'in_progress'::text, 'completed'::text, 'canceled'::text, 'no_show'::text])));

alter table "public"."bookkeeping_entries" add constraint "bookkeeping_entries_amount_check" CHECK (((amount > (0)::numeric) AND (amount <= (100000000)::numeric)));

alter table "public"."bookkeeping_entries" add constraint "bookkeeping_entries_category_check" CHECK (((char_length(category) >= 1) AND (char_length(category) <= 80)));

alter table "public"."bookkeeping_entries" add constraint "bookkeeping_entries_currency_check" CHECK ((currency ~ '^[A-Z]{3}$'::text));

alter table "public"."bookkeeping_entries" add constraint "bookkeeping_entries_description_check" CHECK (((char_length(description) >= 1) AND (char_length(description) <= 400)));

alter table "public"."bookkeeping_entries" add constraint "bookkeeping_entries_direction_check" CHECK ((direction = ANY (ARRAY['income'::text, 'expense'::text])));

alter table "public"."bookkeeping_entries" add constraint "bookkeeping_entries_notes_check" CHECK (((notes IS NULL) OR (char_length(notes) <= 2000)));

alter table "public"."bookkeeping_entries" add constraint "bookkeeping_entries_pkey" PRIMARY KEY (id);

alter table "public"."business_branding" add constraint "business_branding_logo_data_url_check" CHECK (((length(logo_data_url) <= 174800) AND (logo_data_url ~ '^data:image/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$'::text)));

alter table "public"."business_branding" add constraint "business_branding_pkey" PRIMARY KEY (business_id);

alter table "public"."business_members" add constraint "business_members_pkey" PRIMARY KEY (business_id, user_id);

alter table "public"."business_members" add constraint "business_members_role_check" CHECK ((role = ANY (ARRAY['owner'::text, 'admin'::text, 'office'::text, 'technician'::text, 'viewer'::text])));

alter table "public"."business_service_interests" add constraint "business_service_interests_pkey" PRIMARY KEY (business_id);

alter table "public"."business_service_interests" add constraint "business_service_interests_plan_check" CHECK ((preferred_plan = ANY (ARRAY['free'::text, 'basic'::text, 'pro'::text, 'a_la_carte'::text])));

alter table "public"."business_service_interests" add constraint "business_service_interests_services_check" CHECK (((selected_services <@ ARRAY['voice_drafts'::text, 'estimate_approvals'::text, 'payment_links'::text, 'automated_reminders'::text, 'bookkeeping'::text, 'team_tools'::text, 'sms_messages'::text, 'ai_100'::text, 'ai_500'::text, 'storage_1gb'::text, 'storage_5gb'::text]) AND (cardinality(selected_services) <= 11)));

alter table "public"."business_settings" add constraint "business_settings_payment_instructions_check" CHECK ((length(payment_instructions) <= 2000));

alter table "public"."business_settings" add constraint "business_settings_payment_links_check" CHECK (private.valid_payment_links(payment_links));

alter table "public"."business_settings" add constraint "business_settings_pkey" PRIMARY KEY (business_id);

alter table "public"."businesses" add constraint "businesses_pkey" PRIMARY KEY (id);

alter table "public"."businesses" add constraint "commerce_currency_usd" CHECK ((currency = 'USD'::text));

alter table "public"."businesses" add constraint "velnu_business_document_accent_color" CHECK ((document_accent ~ '^#[0-9A-Fa-f]{6}$'::text));

alter table "public"."businesses" add constraint "velnu_business_team_size_range" CHECK (((team_size IS NULL) OR ((team_size >= 0) AND (team_size <= 10000))));

alter table "public"."change_order_items" add constraint "change_order_items_pkey" PRIMARY KEY (id);

alter table "public"."change_order_items" add constraint "change_order_items_quantity_check" CHECK ((quantity > (0)::numeric));

alter table "public"."change_order_items" add constraint "change_order_items_tax_rate_check" CHECK (((tax_rate >= (0)::numeric) AND (tax_rate <= (100)::numeric)));

alter table "public"."change_order_items" add constraint "change_order_items_unit_price_check" CHECK ((unit_price >= (0)::numeric));

alter table "public"."change_orders" add constraint "change_orders_business_id_change_order_number_key" UNIQUE (business_id, change_order_number);

alter table "public"."change_orders" add constraint "change_orders_id_business_id_key" UNIQUE (id, business_id);

alter table "public"."change_orders" add constraint "change_orders_pkey" PRIMARY KEY (id);

alter table "public"."change_orders" add constraint "change_orders_status_check" CHECK ((status = ANY (ARRAY['draft'::text, 'sent'::text, 'approved'::text, 'declined'::text, 'void'::text])));

alter table "public"."change_orders" add constraint "change_orders_subtotal_check" CHECK ((subtotal >= (0)::numeric));

alter table "public"."change_orders" add constraint "change_orders_tax_amount_check" CHECK ((tax_amount >= (0)::numeric));

alter table "public"."change_orders" add constraint "change_orders_total_check" CHECK ((total >= (0)::numeric));

alter table "public"."customers" add constraint "commerce_customer_fields" CHECK (((length(COALESCE(first_name, ''::text)) <= 200) AND (length(COALESCE(last_name, ''::text)) <= 200) AND (length(COALESCE(company, ''::text)) <= 200) AND (length(COALESCE(email, ''::text)) <= 320) AND (length(COALESCE(phone, ''::text)) <= 80) AND (length(COALESCE(notes, ''::text)) <= 4000)));

alter table "public"."customers" add constraint "customers_id_business_id_key" UNIQUE (id, business_id);

alter table "public"."customers" add constraint "customers_pkey" PRIMARY KEY (id);

alter table "public"."customers" add constraint "customers_preferred_contact_check" CHECK ((preferred_contact = ANY (ARRAY['sms'::text, 'email'::text, 'phone'::text, 'none'::text])));

alter table "public"."document_approval_links" add constraint "document_approval_links_check" CHECK ((((document_type = 'estimate'::text) AND (estimate_id IS NOT NULL) AND (change_order_id IS NULL)) OR ((document_type = 'change_order'::text) AND (change_order_id IS NOT NULL) AND (estimate_id IS NULL))));

alter table "public"."document_approval_links" add constraint "document_approval_links_document_type_check" CHECK ((document_type = ANY (ARRAY['estimate'::text, 'change_order'::text])));

alter table "public"."document_approval_links" add constraint "document_approval_links_pkey" PRIMARY KEY (id);

alter table "public"."document_approval_links" add constraint "document_approval_links_token_hash_key" UNIQUE (token_hash);

alter table "public"."document_approvals" add constraint "document_approvals_action_check" CHECK ((action = ANY (ARRAY['approved'::text, 'declined'::text])));

alter table "public"."document_approvals" add constraint "document_approvals_amount_at_action_check" CHECK ((amount_at_action >= (0)::numeric));

alter table "public"."document_approvals" add constraint "document_approvals_approval_link_id_key" UNIQUE (approval_link_id);

alter table "public"."document_approvals" add constraint "document_approvals_check" CHECK ((((document_type = 'estimate'::text) AND (estimate_id IS NOT NULL) AND (change_order_id IS NULL)) OR ((document_type = 'change_order'::text) AND (change_order_id IS NOT NULL) AND (estimate_id IS NULL))));

alter table "public"."document_approvals" add constraint "document_approvals_document_type_check" CHECK ((document_type = ANY (ARRAY['estimate'::text, 'change_order'::text])));

alter table "public"."document_approvals" add constraint "document_approvals_pkey" PRIMARY KEY (id);

alter table "public"."document_approvals" add constraint "document_approvals_typed_name_check" CHECK (((char_length(btrim(typed_name)) >= 2) AND (char_length(btrim(typed_name)) <= 200)));

alter table "public"."estimate_items" add constraint "estimate_item_tax_percent" CHECK (((tax_rate <= (100)::numeric) AND (tax_rate <> 'NaN'::numeric)));

alter table "public"."estimate_items" add constraint "estimate_items_pkey" PRIMARY KEY (id);

alter table "public"."estimate_items" add constraint "estimate_items_quantity_check" CHECK ((quantity > (0)::numeric));

alter table "public"."estimate_items" add constraint "estimate_items_tax_rate_check" CHECK ((tax_rate >= (0)::numeric));

alter table "public"."estimate_items" add constraint "estimate_items_unit_price_check" CHECK ((unit_price >= (0)::numeric));

alter table "public"."estimates" add constraint "estimates_business_id_estimate_number_key" UNIQUE (business_id, estimate_number);

alter table "public"."estimates" add constraint "estimates_id_business_id_key" UNIQUE (id, business_id);

alter table "public"."estimates" add constraint "estimates_pkey" PRIMARY KEY (id);

alter table "public"."estimates" add constraint "estimates_status_check" CHECK ((status = ANY (ARRAY['draft'::text, 'sent'::text, 'accepted'::text, 'declined'::text, 'expired'::text, 'converted'::text])));

alter table "public"."estimates" add constraint "estimates_subtotal_check" CHECK ((subtotal >= (0)::numeric));

alter table "public"."estimates" add constraint "estimates_tax_amount_check" CHECK ((tax_amount >= (0)::numeric));

alter table "public"."estimates" add constraint "estimates_total_check" CHECK ((total >= (0)::numeric));

alter table "public"."invoice_items" add constraint "invoice_item_tax_percent" CHECK (((tax_rate <= (100)::numeric) AND (tax_rate <> 'NaN'::numeric)));

alter table "public"."invoice_items" add constraint "invoice_items_pkey" PRIMARY KEY (id);

alter table "public"."invoice_items" add constraint "invoice_items_quantity_check" CHECK ((quantity > (0)::numeric));

alter table "public"."invoice_items" add constraint "invoice_items_tax_rate_check" CHECK ((tax_rate >= (0)::numeric));

alter table "public"."invoice_items" add constraint "invoice_items_unit_price_check" CHECK ((unit_price >= (0)::numeric));

alter table "public"."invoices" add constraint "invoices_amount_paid_check" CHECK ((amount_paid >= (0)::numeric));

alter table "public"."invoices" add constraint "invoices_business_id_invoice_number_key" UNIQUE (business_id, invoice_number);

alter table "public"."invoices" add constraint "invoices_id_business_id_key" UNIQUE (id, business_id);

alter table "public"."invoices" add constraint "invoices_payment_instructions_check" CHECK ((length(payment_instructions) <= 2000));

alter table "public"."invoices" add constraint "invoices_payment_links_check" CHECK (private.valid_payment_links(payment_links));

alter table "public"."invoices" add constraint "invoices_pkey" PRIMARY KEY (id);

alter table "public"."invoices" add constraint "invoices_status_check" CHECK ((status = ANY (ARRAY['draft'::text, 'sent'::text, 'viewed'::text, 'partial'::text, 'paid'::text, 'overdue'::text, 'void'::text])));

alter table "public"."invoices" add constraint "invoices_subtotal_check" CHECK ((subtotal >= (0)::numeric));

alter table "public"."invoices" add constraint "invoices_tax_amount_check" CHECK ((tax_amount >= (0)::numeric));

alter table "public"."invoices" add constraint "invoices_total_check" CHECK ((total >= (0)::numeric));

alter table "public"."jobs" add constraint "jobs_id_business_id_key" UNIQUE (id, business_id);

alter table "public"."jobs" add constraint "jobs_pkey" PRIMARY KEY (id);

alter table "public"."jobs" add constraint "jobs_status_check" CHECK ((status = ANY (ARRAY['lead'::text, 'scheduled'::text, 'in_progress'::text, 'completed'::text, 'canceled'::text])));

alter table "public"."messages" add constraint "messages_channel_check" CHECK ((channel = ANY (ARRAY['sms'::text, 'email'::text, 'phone'::text, 'system'::text])));

alter table "public"."messages" add constraint "messages_direction_check" CHECK ((direction = ANY (ARRAY['outbound'::text, 'inbound'::text])));

alter table "public"."messages" add constraint "messages_pkey" PRIMARY KEY (id);

alter table "public"."messages" add constraint "messages_status_check" CHECK ((status = ANY (ARRAY['queued'::text, 'sent'::text, 'delivered'::text, 'failed'::text, 'received'::text])));

alter table "public"."payments" add constraint "payments_amount_check" CHECK ((amount > (0)::numeric));

alter table "public"."payments" add constraint "payments_method_check" CHECK ((method = ANY (ARRAY['cash'::text, 'check'::text, 'card'::text, 'ach'::text, 'other'::text])));

alter table "public"."payments" add constraint "payments_pkey" PRIMARY KEY (id);

alter table "public"."payments" add constraint "payments_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'succeeded'::text, 'failed'::text, 'refunded'::text, 'partially_refunded'::text])));

alter table "public"."properties" add constraint "properties_id_business_id_key" UNIQUE (id, business_id);

alter table "public"."properties" add constraint "properties_pkey" PRIMARY KEY (id);

alter table "public"."quickbooks_connections" add constraint "quickbooks_connections_environment_check" CHECK ((environment = ANY (ARRAY['sandbox'::text, 'production'::text])));

alter table "public"."quickbooks_connections" add constraint "quickbooks_connections_pkey" PRIMARY KEY (business_id);

alter table "public"."quickbooks_connections" add constraint "quickbooks_connections_realm_id_check" CHECK (((char_length(realm_id) >= 1) AND (char_length(realm_id) <= 80)));

alter table "public"."quickbooks_connections" add constraint "quickbooks_connections_realm_id_environment_business_id_key" UNIQUE (realm_id, environment, business_id);

alter table "public"."quickbooks_oauth_states" add constraint "quickbooks_oauth_states_environment_check" CHECK ((environment = ANY (ARRAY['sandbox'::text, 'production'::text])));

alter table "public"."quickbooks_oauth_states" add constraint "quickbooks_oauth_states_pkey" PRIMARY KEY (state_hash);

alter table "public"."quickbooks_oauth_states" add constraint "quickbooks_oauth_states_state_hash_check" CHECK ((char_length(state_hash) = 64));

alter table "public"."quickbooks_transactions" add constraint "quickbooks_transactions_amount_check" CHECK (((amount >= (0)::numeric) AND (amount <= (100000000)::numeric)));

alter table "public"."quickbooks_transactions" add constraint "quickbooks_transactions_business_id_realm_id_source_type_so_key" UNIQUE (business_id, realm_id, source_type, source_id);

alter table "public"."quickbooks_transactions" add constraint "quickbooks_transactions_currency_check" CHECK ((currency ~ '^[A-Z]{3}$'::text));

alter table "public"."quickbooks_transactions" add constraint "quickbooks_transactions_description_check" CHECK ((length(description) <= 400));

alter table "public"."quickbooks_transactions" add constraint "quickbooks_transactions_direction_check" CHECK ((direction = ANY (ARRAY['income'::text, 'expense'::text])));

alter table "public"."quickbooks_transactions" add constraint "quickbooks_transactions_pkey" PRIMARY KEY (id);

alter table "public"."quickbooks_transactions" add constraint "quickbooks_transactions_source_id_check" CHECK (((length(source_id) >= 1) AND (length(source_id) <= 120)));

alter table "public"."quickbooks_transactions" add constraint "quickbooks_transactions_source_type_check" CHECK ((source_type = ANY (ARRAY['Payment'::text, 'SalesReceipt'::text, 'Purchase'::text])));

alter table "public"."reminders" add constraint "reminders_pkey" PRIMARY KEY (id);

alter table "public"."reminders" add constraint "reminders_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'completed'::text, 'canceled'::text])));

alter table "public"."user_agreement_acceptances" add constraint "user_agreement_acceptances_acceptance_method_check" CHECK ((acceptance_method = 'checkbox_and_button'::text));

alter table "public"."user_agreement_acceptances" add constraint "user_agreement_acceptances_agreement_version_check" CHECK (((length(agreement_version) >= 1) AND (length(agreement_version) <= 60)));

alter table "public"."user_agreement_acceptances" add constraint "user_agreement_acceptances_ai_disclosure_acknowledged_check" CHECK ((ai_disclosure_acknowledged = true));

alter table "public"."user_agreement_acceptances" add constraint "user_agreement_acceptances_electronic_records_consent_check" CHECK ((electronic_records_consent = true));

alter table "public"."user_agreement_acceptances" add constraint "user_agreement_acceptances_pkey" PRIMARY KEY (id);

alter table "public"."user_agreement_acceptances" add constraint "user_agreement_acceptances_selected_tier_at_acceptance_check" CHECK ((selected_tier_at_acceptance = ANY (ARRAY['free'::text, 'basic'::text, 'pro'::text])));

alter table "public"."user_agreement_acceptances" add constraint "user_agreement_acceptances_terms_accepted_check" CHECK ((terms_accepted = true));

alter table "public"."user_agreement_acceptances" add constraint "user_agreement_user_version_unique" UNIQUE (user_id, agreement_version);

alter table "public"."user_plan_preferences" add constraint "user_plan_preferences_pkey" PRIMARY KEY (user_id);

alter table "public"."user_plan_preferences" add constraint "user_plan_preferences_selected_tier_check" CHECK ((selected_tier = ANY (ARRAY['free'::text, 'basic'::text, 'pro'::text])));

alter table "public"."user_profiles" add constraint "user_profiles_pkey" PRIMARY KEY (user_id);

alter table "public"."voice_transcriptions" add constraint "voice_transcriptions_pkey" PRIMARY KEY (id);

alter table "private"."business_entitlements" add constraint "business_entitlements_business_id_fkey" FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;

alter table "private"."feature_requests" add constraint "feature_requests_business_id_fkey" FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;

alter table "private"."finviant_ai_attempt_budget" add constraint "finviant_ai_attempt_budget_business_id_fkey" FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;

alter table "private"."finviant_email_outbox" add constraint "finviant_email_outbox_actor_id_fkey" FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE CASCADE;

alter table "private"."finviant_email_outbox" add constraint "finviant_email_outbox_business_id_fkey" FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;

alter table "private"."monthly_usage" add constraint "monthly_usage_business_id_fkey" FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;

alter table "public"."ai_actions" add constraint "ai_actions_business_id_fkey" FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;

alter table "public"."ai_actions" add constraint "ai_actions_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

alter table "public"."appointments" add constraint "appointments_assigned_user_id_fkey" FOREIGN KEY (assigned_user_id) REFERENCES auth.users(id);

alter table "public"."appointments" add constraint "appointments_business_id_fkey" FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;

alter table "public"."appointments" add constraint "appointments_customer_id_business_id_fkey" FOREIGN KEY (customer_id, business_id) REFERENCES customers(id, business_id);

alter table "public"."appointments" add constraint "appointments_customer_id_fkey" FOREIGN KEY (customer_id) REFERENCES customers(id);

alter table "public"."appointments" add constraint "appointments_job_id_business_id_fkey" FOREIGN KEY (job_id, business_id) REFERENCES jobs(id, business_id);

alter table "public"."appointments" add constraint "appointments_job_id_fkey" FOREIGN KEY (job_id) REFERENCES jobs(id);

alter table "public"."bookkeeping_entries" add constraint "bookkeeping_entries_business_id_fkey" FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;

alter table "public"."bookkeeping_entries" add constraint "bookkeeping_entries_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id);

alter table "public"."business_branding" add constraint "business_branding_business_id_fkey" FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;

alter table "public"."business_members" add constraint "business_members_business_id_fkey" FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;

alter table "public"."business_members" add constraint "business_members_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

alter table "public"."business_service_interests" add constraint "business_service_interests_business_id_fkey" FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;

alter table "public"."business_service_interests" add constraint "business_service_interests_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES auth.users(id);

alter table "public"."business_settings" add constraint "business_settings_business_id_fkey" FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;

alter table "public"."businesses" add constraint "businesses_created_by_user_id_fkey" FOREIGN KEY (created_by_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

alter table "public"."change_order_items" add constraint "change_order_items_business_id_fkey" FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;

alter table "public"."change_order_items" add constraint "change_order_items_change_order_id_business_id_fkey" FOREIGN KEY (change_order_id, business_id) REFERENCES change_orders(id, business_id);

alter table "public"."change_order_items" add constraint "change_order_items_change_order_id_fkey" FOREIGN KEY (change_order_id) REFERENCES change_orders(id) ON DELETE CASCADE;

alter table "public"."change_orders" add constraint "change_orders_business_id_fkey" FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;

alter table "public"."change_orders" add constraint "change_orders_customer_id_business_id_fkey" FOREIGN KEY (customer_id, business_id) REFERENCES customers(id, business_id);

alter table "public"."change_orders" add constraint "change_orders_customer_id_fkey" FOREIGN KEY (customer_id) REFERENCES customers(id);

alter table "public"."change_orders" add constraint "change_orders_estimate_id_business_id_fkey" FOREIGN KEY (estimate_id, business_id) REFERENCES estimates(id, business_id);

alter table "public"."change_orders" add constraint "change_orders_estimate_id_fkey" FOREIGN KEY (estimate_id) REFERENCES estimates(id);

alter table "public"."change_orders" add constraint "change_orders_job_id_business_id_fkey" FOREIGN KEY (job_id, business_id) REFERENCES jobs(id, business_id);

alter table "public"."change_orders" add constraint "change_orders_job_id_fkey" FOREIGN KEY (job_id) REFERENCES jobs(id);

alter table "public"."customers" add constraint "customers_business_id_fkey" FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;

alter table "public"."document_approval_links" add constraint "document_approval_links_business_id_fkey" FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;

alter table "public"."document_approval_links" add constraint "document_approval_links_change_order_id_business_id_fkey" FOREIGN KEY (change_order_id, business_id) REFERENCES change_orders(id, business_id);

alter table "public"."document_approval_links" add constraint "document_approval_links_change_order_id_fkey" FOREIGN KEY (change_order_id) REFERENCES change_orders(id) ON DELETE CASCADE;

alter table "public"."document_approval_links" add constraint "document_approval_links_created_by_user_id_fkey" FOREIGN KEY (created_by_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

alter table "public"."document_approval_links" add constraint "document_approval_links_estimate_id_business_id_fkey" FOREIGN KEY (estimate_id, business_id) REFERENCES estimates(id, business_id);

alter table "public"."document_approval_links" add constraint "document_approval_links_estimate_id_fkey" FOREIGN KEY (estimate_id) REFERENCES estimates(id) ON DELETE CASCADE;

alter table "public"."document_approvals" add constraint "document_approvals_approval_link_id_fkey" FOREIGN KEY (approval_link_id) REFERENCES document_approval_links(id) ON DELETE RESTRICT;

alter table "public"."document_approvals" add constraint "document_approvals_business_id_fkey" FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;

alter table "public"."document_approvals" add constraint "document_approvals_change_order_id_business_id_fkey" FOREIGN KEY (change_order_id, business_id) REFERENCES change_orders(id, business_id);

alter table "public"."document_approvals" add constraint "document_approvals_change_order_id_fkey" FOREIGN KEY (change_order_id) REFERENCES change_orders(id) ON DELETE RESTRICT;

alter table "public"."document_approvals" add constraint "document_approvals_estimate_id_business_id_fkey" FOREIGN KEY (estimate_id, business_id) REFERENCES estimates(id, business_id);

alter table "public"."document_approvals" add constraint "document_approvals_estimate_id_fkey" FOREIGN KEY (estimate_id) REFERENCES estimates(id) ON DELETE RESTRICT;

alter table "public"."estimate_items" add constraint "estimate_items_business_id_fkey" FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;

alter table "public"."estimate_items" add constraint "estimate_items_estimate_id_business_id_fkey" FOREIGN KEY (estimate_id, business_id) REFERENCES estimates(id, business_id);

alter table "public"."estimate_items" add constraint "estimate_items_estimate_id_fkey" FOREIGN KEY (estimate_id) REFERENCES estimates(id) ON DELETE CASCADE;

alter table "public"."estimates" add constraint "estimates_business_id_fkey" FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;

alter table "public"."estimates" add constraint "estimates_customer_id_business_id_fkey" FOREIGN KEY (customer_id, business_id) REFERENCES customers(id, business_id);

alter table "public"."estimates" add constraint "estimates_customer_id_fkey" FOREIGN KEY (customer_id) REFERENCES customers(id);

alter table "public"."estimates" add constraint "estimates_job_id_business_id_fkey" FOREIGN KEY (job_id, business_id) REFERENCES jobs(id, business_id);

alter table "public"."estimates" add constraint "estimates_job_id_fkey" FOREIGN KEY (job_id) REFERENCES jobs(id);

alter table "public"."invoice_items" add constraint "invoice_items_business_id_fkey" FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;

alter table "public"."invoice_items" add constraint "invoice_items_invoice_id_business_id_fkey" FOREIGN KEY (invoice_id, business_id) REFERENCES invoices(id, business_id);

alter table "public"."invoice_items" add constraint "invoice_items_invoice_id_fkey" FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE;

alter table "public"."invoices" add constraint "invoices_business_id_fkey" FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;

alter table "public"."invoices" add constraint "invoices_customer_id_business_id_fkey" FOREIGN KEY (customer_id, business_id) REFERENCES customers(id, business_id);

alter table "public"."invoices" add constraint "invoices_customer_id_fkey" FOREIGN KEY (customer_id) REFERENCES customers(id);

alter table "public"."invoices" add constraint "invoices_estimate_id_business_id_fkey" FOREIGN KEY (estimate_id, business_id) REFERENCES estimates(id, business_id);

alter table "public"."invoices" add constraint "invoices_estimate_id_fkey" FOREIGN KEY (estimate_id) REFERENCES estimates(id);

alter table "public"."invoices" add constraint "invoices_job_id_business_id_fkey" FOREIGN KEY (job_id, business_id) REFERENCES jobs(id, business_id);

alter table "public"."invoices" add constraint "invoices_job_id_fkey" FOREIGN KEY (job_id) REFERENCES jobs(id);

alter table "public"."jobs" add constraint "jobs_business_id_fkey" FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;

alter table "public"."jobs" add constraint "jobs_customer_id_business_id_fkey" FOREIGN KEY (customer_id, business_id) REFERENCES customers(id, business_id);

alter table "public"."jobs" add constraint "jobs_customer_id_fkey" FOREIGN KEY (customer_id) REFERENCES customers(id);

alter table "public"."jobs" add constraint "jobs_property_id_business_id_fkey" FOREIGN KEY (property_id, business_id) REFERENCES properties(id, business_id);

alter table "public"."jobs" add constraint "jobs_property_id_fkey" FOREIGN KEY (property_id) REFERENCES properties(id);

alter table "public"."messages" add constraint "messages_business_id_fkey" FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;

alter table "public"."messages" add constraint "messages_change_order_id_fkey" FOREIGN KEY (change_order_id) REFERENCES change_orders(id);

alter table "public"."messages" add constraint "messages_change_order_same_business_fk" FOREIGN KEY (change_order_id, business_id) REFERENCES change_orders(id, business_id);

alter table "public"."messages" add constraint "messages_customer_id_business_id_fkey" FOREIGN KEY (customer_id, business_id) REFERENCES customers(id, business_id);

alter table "public"."messages" add constraint "messages_customer_id_fkey" FOREIGN KEY (customer_id) REFERENCES customers(id);

alter table "public"."messages" add constraint "messages_estimate_id_business_id_fkey" FOREIGN KEY (estimate_id, business_id) REFERENCES estimates(id, business_id);

alter table "public"."messages" add constraint "messages_estimate_id_fkey" FOREIGN KEY (estimate_id) REFERENCES estimates(id);

alter table "public"."messages" add constraint "messages_invoice_id_business_id_fkey" FOREIGN KEY (invoice_id, business_id) REFERENCES invoices(id, business_id);

alter table "public"."messages" add constraint "messages_invoice_id_fkey" FOREIGN KEY (invoice_id) REFERENCES invoices(id);

alter table "public"."payments" add constraint "payments_business_id_fkey" FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;

alter table "public"."payments" add constraint "payments_invoice_id_business_id_fkey" FOREIGN KEY (invoice_id, business_id) REFERENCES invoices(id, business_id);

alter table "public"."payments" add constraint "payments_invoice_id_fkey" FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE;

alter table "public"."properties" add constraint "properties_business_id_fkey" FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;

alter table "public"."properties" add constraint "properties_customer_id_business_id_fkey" FOREIGN KEY (customer_id, business_id) REFERENCES customers(id, business_id);

alter table "public"."properties" add constraint "properties_customer_id_fkey" FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE;

alter table "public"."quickbooks_connections" add constraint "quickbooks_connections_business_id_fkey" FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;

alter table "public"."quickbooks_connections" add constraint "quickbooks_connections_connected_by_fkey" FOREIGN KEY (connected_by) REFERENCES auth.users(id);

alter table "public"."quickbooks_oauth_states" add constraint "quickbooks_oauth_states_business_id_fkey" FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;

alter table "public"."quickbooks_oauth_states" add constraint "quickbooks_oauth_states_initiated_by_fkey" FOREIGN KEY (initiated_by) REFERENCES auth.users(id);

alter table "public"."quickbooks_transactions" add constraint "quickbooks_transactions_business_id_fkey" FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;

alter table "public"."reminders" add constraint "reminders_business_id_fkey" FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;

alter table "public"."reminders" add constraint "reminders_customer_id_business_id_fkey" FOREIGN KEY (customer_id, business_id) REFERENCES customers(id, business_id);

alter table "public"."reminders" add constraint "reminders_customer_id_fkey" FOREIGN KEY (customer_id) REFERENCES customers(id);

alter table "public"."reminders" add constraint "reminders_estimate_id_business_id_fkey" FOREIGN KEY (estimate_id, business_id) REFERENCES estimates(id, business_id);

alter table "public"."reminders" add constraint "reminders_estimate_id_fkey" FOREIGN KEY (estimate_id) REFERENCES estimates(id);

alter table "public"."reminders" add constraint "reminders_invoice_id_business_id_fkey" FOREIGN KEY (invoice_id, business_id) REFERENCES invoices(id, business_id);

alter table "public"."reminders" add constraint "reminders_invoice_id_fkey" FOREIGN KEY (invoice_id) REFERENCES invoices(id);

alter table "public"."reminders" add constraint "reminders_job_id_business_id_fkey" FOREIGN KEY (job_id, business_id) REFERENCES jobs(id, business_id);

alter table "public"."reminders" add constraint "reminders_job_id_fkey" FOREIGN KEY (job_id) REFERENCES jobs(id);

alter table "public"."user_agreement_acceptances" add constraint "user_agreement_acceptances_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

alter table "public"."user_plan_preferences" add constraint "user_plan_preferences_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

alter table "public"."user_profiles" add constraint "user_profiles_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

alter table "public"."voice_transcriptions" add constraint "voice_transcriptions_business_id_fkey" FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;

alter table "public"."voice_transcriptions" add constraint "voice_transcriptions_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

alter table "private"."business_entitlements" enable row level security;

alter table "private"."feature_requests" enable row level security;

alter table "private"."finviant_ai_attempt_budget" enable row level security;

CREATE INDEX idx_fv_delivery_events_message ON private.finviant_delivery_events USING btree (provider_id, occurred_at);

alter table "private"."finviant_delivery_events" enable row level security;

CREATE INDEX idx_fv_outbox_actor ON private.finviant_email_outbox USING btree (actor_id);

CREATE INDEX idx_fv_outbox_business ON private.finviant_email_outbox USING btree (business_id, created_at);

CREATE UNIQUE INDEX idx_fv_outbox_pending_document ON private.finviant_email_outbox USING btree (business_id, document_kind, document_id) WHERE (status = ANY (ARRAY['queued'::text, 'sending'::text, 'uncertain'::text, 'reconciliation_required'::text]));

CREATE INDEX idx_fv_outbox_ready ON private.finviant_email_outbox USING btree (status, next_attempt_at);

alter table "private"."finviant_email_outbox" enable row level security;

CREATE INDEX idx_fv_payment_inbox_pending ON private.finviant_payment_events USING btree (state, received_at);

alter table "private"."finviant_payment_events" enable row level security;

alter table "private"."monthly_usage" enable row level security;

CREATE INDEX idx_ai_actions_business_created ON public.ai_actions USING btree (business_id, created_at);

CREATE INDEX idx_fv_ai_action_owner_recent ON public.ai_actions USING btree (user_id, created_at DESC);

CREATE INDEX idx_fv_fk_ai_actions_44d3485999 ON public.ai_actions USING btree (user_id);

alter table "public"."ai_actions" enable row level security;

CREATE INDEX idx_appointments_business_starts ON public.appointments USING btree (business_id, starts_at);

CREATE INDEX idx_finviant_appointments_job_business ON public.appointments USING btree (job_id, business_id);

CREATE INDEX idx_fv_fk_appointments_390ef23770 ON public.appointments USING btree (customer_id, business_id);

CREATE INDEX idx_fv_fk_appointments_ca895383d0 ON public.appointments USING btree (assigned_user_id);

alter table "public"."appointments" enable row level security;

CREATE INDEX bookkeeping_entries_business_date_idx ON public.bookkeeping_entries USING btree (business_id, entry_date DESC);

CREATE INDEX idx_fv_fk_bookkeeping_entries_14e7780eaf ON public.bookkeeping_entries USING btree (created_by);

alter table "public"."bookkeeping_entries" enable row level security;

alter table "public"."business_branding" enable row level security;

CREATE INDEX idx_business_members_user ON public.business_members USING btree (user_id);

alter table "public"."business_members" enable row level security;

CREATE INDEX idx_fv_fk_business_service_interests_47d9f72392 ON public.business_service_interests USING btree (updated_by);

alter table "public"."business_service_interests" enable row level security;

alter table "public"."business_settings" enable row level security;

CREATE INDEX businesses_created_by_user_id_idx ON public.businesses USING btree (created_by_user_id);

alter table "public"."businesses" enable row level security;

CREATE INDEX change_order_items_change_order_idx ON public.change_order_items USING btree (change_order_id);

CREATE INDEX idx_fv_fk_change_order_items_a38111b760 ON public.change_order_items USING btree (change_order_id, business_id);

CREATE INDEX idx_fv_fk_change_order_items_d10a5bc494 ON public.change_order_items USING btree (business_id);

alter table "public"."change_order_items" enable row level security;

CREATE UNIQUE INDEX change_order_request_unique ON public.change_orders USING btree (business_id, request_id) WHERE (request_id IS NOT NULL);

CREATE INDEX change_orders_business_idx ON public.change_orders USING btree (business_id);

CREATE INDEX change_orders_customer_idx ON public.change_orders USING btree (customer_id);

CREATE INDEX change_orders_job_idx ON public.change_orders USING btree (job_id);

CREATE INDEX change_orders_status_idx ON public.change_orders USING btree (business_id, status);

CREATE INDEX idx_fv_fk_change_orders_2d84f499dc ON public.change_orders USING btree (customer_id, business_id);

CREATE INDEX idx_fv_fk_change_orders_32779fabc0 ON public.change_orders USING btree (estimate_id, business_id);

CREATE INDEX idx_fv_fk_change_orders_8980fae534 ON public.change_orders USING btree (job_id, business_id);

CREATE INDEX idx_velnu_change_orders_recent ON public.change_orders USING btree (business_id, created_at DESC);

alter table "public"."change_orders" enable row level security;

CREATE INDEX idx_customers_business ON public.customers USING btree (business_id);

alter table "public"."customers" enable row level security;

CREATE INDEX document_approval_links_business_idx ON public.document_approval_links USING btree (business_id);

CREATE INDEX document_approval_links_change_order_idx ON public.document_approval_links USING btree (change_order_id) WHERE (change_order_id IS NOT NULL);

CREATE INDEX document_approval_links_estimate_idx ON public.document_approval_links USING btree (estimate_id) WHERE (estimate_id IS NOT NULL);

CREATE INDEX idx_fv_fk_document_approval_links_3a2112fb6c ON public.document_approval_links USING btree (estimate_id, business_id);

CREATE INDEX idx_fv_fk_document_approval_links_7c22eefd6b ON public.document_approval_links USING btree (change_order_id, business_id);

CREATE INDEX idx_fv_fk_document_approval_links_bc3a308d32 ON public.document_approval_links USING btree (created_by_user_id);

alter table "public"."document_approval_links" enable row level security;

CREATE INDEX document_approvals_business_idx ON public.document_approvals USING btree (business_id);

CREATE INDEX document_approvals_change_order_idx ON public.document_approvals USING btree (change_order_id) WHERE (change_order_id IS NOT NULL);

CREATE INDEX document_approvals_estimate_idx ON public.document_approvals USING btree (estimate_id) WHERE (estimate_id IS NOT NULL);

CREATE INDEX idx_fv_fk_document_approvals_a3db15cbbd ON public.document_approvals USING btree (change_order_id, business_id);

CREATE INDEX idx_fv_fk_document_approvals_c83f5c768c ON public.document_approvals USING btree (estimate_id, business_id);

alter table "public"."document_approvals" enable row level security;

CREATE INDEX idx_fv_estimate_items_parent_tenant ON public.estimate_items USING btree (estimate_id, business_id);

CREATE INDEX idx_velnu_estimate_items_detail ON public.estimate_items USING btree (business_id, estimate_id, sort_order);

alter table "public"."estimate_items" enable row level security;

CREATE UNIQUE INDEX estimate_request_unique ON public.estimates USING btree (business_id, request_id) WHERE (request_id IS NOT NULL);

CREATE INDEX idx_estimates_business_status ON public.estimates USING btree (business_id, status);

CREATE INDEX idx_fv_fk_estimates_798ac1278f ON public.estimates USING btree (customer_id, business_id);

CREATE INDEX idx_fv_fk_estimates_fce0f6699f ON public.estimates USING btree (job_id, business_id);

CREATE INDEX idx_velnu_estimates_recent ON public.estimates USING btree (business_id, created_at DESC);

alter table "public"."estimates" enable row level security;

CREATE INDEX idx_fv_invoice_items_parent_tenant ON public.invoice_items USING btree (invoice_id, business_id);

CREATE INDEX idx_velnu_invoice_items_detail ON public.invoice_items USING btree (business_id, invoice_id, sort_order);

alter table "public"."invoice_items" enable row level security;

CREATE INDEX idx_fv_fk_invoices_0a672e0e63 ON public.invoices USING btree (customer_id, business_id);

CREATE INDEX idx_fv_fk_invoices_2af727d027 ON public.invoices USING btree (estimate_id, business_id);

CREATE INDEX idx_fv_fk_invoices_f7045eab46 ON public.invoices USING btree (job_id, business_id);

CREATE INDEX idx_invoices_business_status ON public.invoices USING btree (business_id, status);

CREATE INDEX idx_invoices_due_date ON public.invoices USING btree (business_id, due_date);

CREATE INDEX idx_velnu_invoices_open_balance ON public.invoices USING btree (business_id) INCLUDE (balance_due) WHERE ((balance_due > (0)::numeric) AND (status <> ALL (ARRAY['draft'::text, 'void'::text])));

CREATE INDEX idx_velnu_invoices_recent ON public.invoices USING btree (business_id, created_at DESC);

CREATE UNIQUE INDEX invoice_request_unique ON public.invoices USING btree (business_id, request_id) WHERE (request_id IS NOT NULL);

CREATE UNIQUE INDEX invoice_single_conversion ON public.invoices USING btree (estimate_id) WHERE (estimate_id IS NOT NULL);

alter table "public"."invoices" enable row level security;

CREATE INDEX idx_fv_fk_jobs_eed062575a ON public.jobs USING btree (property_id, business_id);

CREATE INDEX idx_fv_jobs_customer_tenant ON public.jobs USING btree (customer_id, business_id);

CREATE INDEX idx_jobs_business_status ON public.jobs USING btree (business_id, status);

CREATE INDEX idx_velnu_jobs_customer_recent ON public.jobs USING btree (business_id, customer_id, created_at DESC);

CREATE UNIQUE INDEX idx_velnu_jobs_scheduled_request ON public.jobs USING btree (business_id, request_id) WHERE (request_id IS NOT NULL);

alter table "public"."jobs" enable row level security;

CREATE INDEX idx_fv_fk_messages_21d0df6ace ON public.messages USING btree (estimate_id, business_id);

CREATE INDEX idx_fv_fk_messages_675809bbc8 ON public.messages USING btree (change_order_id, business_id);

CREATE INDEX idx_fv_fk_messages_a28a715b43 ON public.messages USING btree (customer_id, business_id);

CREATE INDEX idx_fv_fk_messages_bf72554869 ON public.messages USING btree (invoice_id, business_id);

CREATE INDEX idx_fv_messages_email_hour ON public.messages USING btree (business_id, created_at DESC) WHERE ((channel = 'email'::text) AND (direction = 'outbound'::text));

CREATE INDEX idx_messages_business_created ON public.messages USING btree (business_id, created_at);

CREATE INDEX messages_change_order_id_idx ON public.messages USING btree (change_order_id);

CREATE UNIQUE INDEX messages_provider_message_unique_idx ON public.messages USING btree (provider, provider_message_id) WHERE (provider_message_id IS NOT NULL);

alter table "public"."messages" enable row level security;

CREATE INDEX idx_fv_payments_invoice_tenant ON public.payments USING btree (invoice_id, business_id);

CREATE INDEX idx_velnu_payments_invoice_history ON public.payments USING btree (business_id, invoice_id, paid_at DESC);

CREATE UNIQUE INDEX payment_request_unique ON public.payments USING btree (business_id, request_id) WHERE (request_id IS NOT NULL);

CREATE UNIQUE INDEX payments_provider_payment_unique ON public.payments USING btree (business_id, provider, provider_payment_id) WHERE ((provider IS NOT NULL) AND (provider_payment_id IS NOT NULL));

alter table "public"."payments" enable row level security;

CREATE INDEX idx_fv_fk_properties_c0fc29457d ON public.properties USING btree (business_id);

CREATE INDEX idx_fv_fk_properties_f4c8a79ed2 ON public.properties USING btree (customer_id, business_id);

CREATE INDEX idx_properties_customer ON public.properties USING btree (customer_id);

alter table "public"."properties" enable row level security;

CREATE INDEX idx_fv_fk_quickbooks_connections_9bee4be030 ON public.quickbooks_connections USING btree (connected_by);

alter table "public"."quickbooks_connections" enable row level security;

CREATE INDEX idx_fv_fk_quickbooks_oauth_states_1a5ea209e3 ON public.quickbooks_oauth_states USING btree (initiated_by);

CREATE INDEX idx_fv_fk_quickbooks_oauth_states_78df79dc31 ON public.quickbooks_oauth_states USING btree (business_id);

CREATE INDEX quickbooks_oauth_states_expiry_idx ON public.quickbooks_oauth_states USING btree (expires_at);

alter table "public"."quickbooks_oauth_states" enable row level security;

CREATE INDEX quickbooks_transactions_business_date_idx ON public.quickbooks_transactions USING btree (business_id, txn_date DESC);

alter table "public"."quickbooks_transactions" enable row level security;

CREATE INDEX idx_fv_fk_reminders_2137b54b1f ON public.reminders USING btree (invoice_id, business_id);

CREATE INDEX idx_fv_fk_reminders_34bdff82e8 ON public.reminders USING btree (customer_id, business_id);

CREATE INDEX idx_fv_fk_reminders_55c9179840 ON public.reminders USING btree (estimate_id, business_id);

CREATE INDEX idx_fv_fk_reminders_6fbf180bb9 ON public.reminders USING btree (job_id, business_id);

CREATE INDEX idx_reminders_business_due ON public.reminders USING btree (business_id, due_at, status);

alter table "public"."reminders" enable row level security;

alter table "public"."user_agreement_acceptances" enable row level security;

alter table "public"."user_plan_preferences" enable row level security;

alter table "public"."user_profiles" enable row level security;

CREATE INDEX idx_fv_fk_voice_transcriptions_680a243632 ON public.voice_transcriptions USING btree (business_id);

CREATE INDEX idx_fv_fk_voice_transcriptions_6ddb0126f9 ON public.voice_transcriptions USING btree (user_id);

CREATE INDEX idx_fv_voice_user_created ON public.voice_transcriptions USING btree (user_id, created_at DESC);

alter table "public"."voice_transcriptions" enable row level security;

CREATE TRIGGER ai_confirmation_guard BEFORE UPDATE ON public.ai_actions FOR EACH ROW EXECUTE FUNCTION private.ai_confirmation_guard();

CREATE TRIGGER appointments_set_updated_at BEFORE UPDATE ON public.appointments FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER commerce_auxiliary_limit BEFORE INSERT OR UPDATE ON public.appointments FOR EACH ROW EXECUTE FUNCTION private.commerce_auxiliary_limit();

CREATE TRIGGER finviant_guard_active_appointment BEFORE INSERT OR UPDATE OF status, job_id, business_id ON public.appointments FOR EACH ROW EXECUTE FUNCTION private.finviant_guard_active_appointment();

CREATE TRIGGER velnu_financial_access BEFORE INSERT OR DELETE OR UPDATE ON public.bookkeeping_entries FOR EACH ROW EXECUTE FUNCTION private.velnu_financial_role_guard();

CREATE TRIGGER commerce_auxiliary_limit BEFORE INSERT OR UPDATE ON public.business_members FOR EACH ROW EXECUTE FUNCTION private.commerce_auxiliary_limit();

CREATE TRIGGER velnu_membership_role_guard BEFORE INSERT OR DELETE OR UPDATE ON public.business_members FOR EACH ROW EXECUTE FUNCTION private.velnu_membership_role_guard();

CREATE TRIGGER trg_touch_business_service_interests BEFORE UPDATE ON public.business_service_interests FOR EACH ROW EXECUTE FUNCTION private.touch_business_service_interests();

CREATE TRIGGER businesses_bootstrap_owner AFTER INSERT ON public.businesses FOR EACH ROW EXECUTE FUNCTION bootstrap_business_owner();

CREATE TRIGGER businesses_set_updated_at BEFORE UPDATE ON public.businesses FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER commerce_business_guard BEFORE INSERT OR UPDATE ON public.businesses FOR EACH ROW EXECUTE FUNCTION private.commerce_business_guard();

CREATE TRIGGER change_order_items_recalc AFTER INSERT OR DELETE OR UPDATE ON public.change_order_items FOR EACH ROW EXECUTE FUNCTION recalc_change_order();

CREATE TRIGGER commerce_change_item_guard BEFORE INSERT OR DELETE OR UPDATE ON public.change_order_items FOR EACH ROW EXECUTE FUNCTION private.commerce_change_item_guard();

CREATE TRIGGER velnu_financial_access BEFORE INSERT OR DELETE OR UPDATE ON public.change_order_items FOR EACH ROW EXECUTE FUNCTION private.velnu_financial_role_guard();

CREATE TRIGGER change_orders_assign_number BEFORE INSERT ON public.change_orders FOR EACH ROW EXECUTE FUNCTION assign_change_order_number();

CREATE TRIGGER change_orders_set_updated_at BEFORE UPDATE ON public.change_orders FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER change_orders_status_timestamps BEFORE UPDATE ON public.change_orders FOR EACH ROW EXECUTE FUNCTION set_change_order_status_timestamps();

CREATE TRIGGER commerce_quota BEFORE INSERT ON public.change_orders FOR EACH ROW EXECUTE FUNCTION private.commerce_quota();

CREATE TRIGGER velnu_financial_access BEFORE INSERT OR DELETE OR UPDATE ON public.change_orders FOR EACH ROW EXECUTE FUNCTION private.velnu_financial_role_guard();

CREATE TRIGGER velnu_freeze_issuer BEFORE INSERT OR UPDATE ON public.change_orders FOR EACH ROW EXECUTE FUNCTION private.velnu_freeze_document_issuer();

CREATE TRIGGER commerce_quota BEFORE INSERT ON public.customers FOR EACH ROW EXECUTE FUNCTION private.commerce_quota();

CREATE TRIGGER customers_set_updated_at BEFORE UPDATE ON public.customers FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER commerce_item_guard BEFORE INSERT OR DELETE OR UPDATE ON public.estimate_items FOR EACH ROW EXECUTE FUNCTION private.commerce_item_guard();

CREATE TRIGGER commerce_items_recalc AFTER INSERT OR DELETE OR UPDATE ON public.estimate_items FOR EACH ROW EXECUTE FUNCTION private.commerce_recalc();

CREATE TRIGGER velnu_financial_access BEFORE INSERT OR DELETE OR UPDATE ON public.estimate_items FOR EACH ROW EXECUTE FUNCTION private.velnu_financial_role_guard();

CREATE TRIGGER commerce_document_guard BEFORE INSERT OR DELETE OR UPDATE ON public.estimates FOR EACH ROW EXECUTE FUNCTION private.commerce_document_guard();

CREATE TRIGGER commerce_identity_guard BEFORE UPDATE ON public.estimates FOR EACH ROW EXECUTE FUNCTION private.commerce_identity_guard();

CREATE TRIGGER commerce_number BEFORE INSERT ON public.estimates FOR EACH ROW EXECUTE FUNCTION private.commerce_number();

CREATE TRIGGER commerce_quota BEFORE INSERT ON public.estimates FOR EACH ROW EXECUTE FUNCTION private.commerce_quota();

CREATE TRIGGER estimates_set_updated_at BEFORE UPDATE ON public.estimates FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER velnu_financial_access BEFORE INSERT OR DELETE OR UPDATE ON public.estimates FOR EACH ROW EXECUTE FUNCTION private.velnu_financial_role_guard();

CREATE TRIGGER velnu_freeze_issuer BEFORE INSERT OR UPDATE ON public.estimates FOR EACH ROW EXECUTE FUNCTION private.velnu_freeze_document_issuer();

CREATE TRIGGER commerce_item_guard BEFORE INSERT OR DELETE OR UPDATE ON public.invoice_items FOR EACH ROW EXECUTE FUNCTION private.commerce_item_guard();

CREATE TRIGGER commerce_items_recalc AFTER INSERT OR DELETE OR UPDATE ON public.invoice_items FOR EACH ROW EXECUTE FUNCTION private.commerce_recalc();

CREATE TRIGGER velnu_financial_access BEFORE INSERT OR DELETE OR UPDATE ON public.invoice_items FOR EACH ROW EXECUTE FUNCTION private.velnu_financial_role_guard();

CREATE TRIGGER commerce_document_guard BEFORE INSERT OR DELETE OR UPDATE ON public.invoices FOR EACH ROW EXECUTE FUNCTION private.commerce_document_guard();

CREATE TRIGGER commerce_identity_guard BEFORE UPDATE ON public.invoices FOR EACH ROW EXECUTE FUNCTION private.commerce_identity_guard();

CREATE TRIGGER commerce_number BEFORE INSERT ON public.invoices FOR EACH ROW EXECUTE FUNCTION private.commerce_number();

CREATE TRIGGER commerce_quota BEFORE INSERT ON public.invoices FOR EACH ROW EXECUTE FUNCTION private.commerce_quota();

CREATE TRIGGER invoices_set_updated_at BEFORE UPDATE ON public.invoices FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER velnu_financial_access BEFORE INSERT OR DELETE OR UPDATE ON public.invoices FOR EACH ROW EXECUTE FUNCTION private.velnu_financial_role_guard();

CREATE TRIGGER velnu_freeze_issuer BEFORE INSERT OR UPDATE ON public.invoices FOR EACH ROW EXECUTE FUNCTION private.velnu_freeze_document_issuer();

CREATE TRIGGER commerce_auxiliary_limit BEFORE INSERT OR UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION private.commerce_auxiliary_limit();

CREATE TRIGGER finviant_sync_job_status AFTER UPDATE OF status ON public.jobs FOR EACH ROW EXECUTE FUNCTION private.finviant_sync_job_status();

CREATE TRIGGER jobs_set_updated_at BEFORE UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER commerce_auxiliary_limit BEFORE INSERT OR UPDATE ON public.messages FOR EACH ROW EXECUTE FUNCTION private.commerce_auxiliary_limit();

CREATE TRIGGER commerce_paid_recalc AFTER INSERT OR DELETE OR UPDATE ON public.payments FOR EACH ROW EXECUTE FUNCTION private.commerce_paid_recalc();

CREATE TRIGGER commerce_payment_guard BEFORE INSERT OR DELETE OR UPDATE ON public.payments FOR EACH ROW EXECUTE FUNCTION private.commerce_payment_guard();

CREATE TRIGGER payments_prevent_overpayment BEFORE INSERT OR UPDATE ON public.payments FOR EACH ROW EXECUTE FUNCTION prevent_invoice_overpayment();

CREATE TRIGGER velnu_financial_access BEFORE INSERT OR DELETE OR UPDATE ON public.payments FOR EACH ROW EXECUTE FUNCTION private.velnu_financial_role_guard();

CREATE TRIGGER commerce_auxiliary_limit BEFORE INSERT OR UPDATE ON public.properties FOR EACH ROW EXECUTE FUNCTION private.commerce_auxiliary_limit();

CREATE TRIGGER properties_set_updated_at BEFORE UPDATE ON public.properties FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER commerce_auxiliary_limit BEFORE INSERT OR UPDATE ON public.reminders FOR EACH ROW EXECUTE FUNCTION private.commerce_auxiliary_limit();

CREATE TRIGGER trg_user_agreement_acceptance_time BEFORE INSERT ON public.user_agreement_acceptances FOR EACH ROW EXECUTE FUNCTION private.set_user_agreement_acceptance_time();

CREATE TRIGGER user_profiles_set_updated_at BEFORE UPDATE ON public.user_profiles FOR EACH ROW EXECUTE FUNCTION set_updated_at();

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values ('velnu-business-logos','velnu-business-logos',true,2097152,array['image/png','image/jpeg','image/webp']);

create policy "entitlements_deny_client" on "private"."business_entitlements" as PERMISSIVE for ALL to "anon", "authenticated" using (false) with check (false);

create policy "requests_deny_client" on "private"."feature_requests" as PERMISSIVE for ALL to "anon", "authenticated" using (false) with check (false);

create policy "usage_deny_client" on "private"."monthly_usage" as PERMISSIVE for ALL to "anon", "authenticated" using (false) with check (false);

create policy "ai_actions_own_read" on "public"."ai_actions" as PERMISSIVE for SELECT to "authenticated" using (((user_id = ( SELECT auth.uid() AS uid)) AND private.is_business_member(business_id) AND ((COALESCE(intent, ''::text) <> ALL (ARRAY['create_invoice'::text, 'create_estimate'::text, 'record_payment'::text, 'create_change_order'::text])) OR (EXISTS ( SELECT 1
   FROM business_members bm
  WHERE ((bm.business_id = ai_actions.business_id) AND (bm.user_id = ( SELECT auth.uid() AS uid)) AND (bm.role = ANY (ARRAY['owner'::text, 'admin'::text, 'office'::text]))))))));

create policy "appointments_member_select" on "public"."appointments" as PERMISSIVE for SELECT to "authenticated" using (private.is_business_member(business_id));

create policy "appointments_writer_delete" on "public"."appointments" as PERMISSIVE for DELETE to "authenticated" using (private.can_write_business(business_id));

create policy "appointments_writer_insert" on "public"."appointments" as PERMISSIVE for INSERT to "authenticated" with check (private.can_write_business(business_id));

create policy "appointments_writer_update" on "public"."appointments" as PERMISSIVE for UPDATE to "authenticated" using (private.can_write_business(business_id)) with check (private.can_write_business(business_id));

create policy "bookkeeping_entries_finance_delete" on "public"."bookkeeping_entries" as PERMISSIVE for DELETE to "authenticated" using (private.has_business_role(business_id, ARRAY['owner'::text, 'admin'::text, 'office'::text]));

create policy "bookkeeping_entries_finance_read" on "public"."bookkeeping_entries" as PERMISSIVE for SELECT to "authenticated" using (private.has_business_role(business_id, ARRAY['owner'::text, 'admin'::text, 'office'::text]));

create policy "bookkeeping_entries_finance_write" on "public"."bookkeeping_entries" as PERMISSIVE for INSERT to "authenticated" with check ((private.has_business_role(business_id, ARRAY['owner'::text, 'admin'::text, 'office'::text]) AND (created_by = ( SELECT auth.uid() AS uid))));

create policy "branding_delete" on "public"."business_branding" as PERMISSIVE for DELETE to "authenticated" using (private.has_business_role(business_id, ARRAY['owner'::text, 'admin'::text]));

create policy "branding_insert" on "public"."business_branding" as PERMISSIVE for INSERT to "authenticated" with check ((private.has_business_role(business_id, ARRAY['owner'::text, 'admin'::text]) AND private.is_pro(business_id)));

create policy "branding_read" on "public"."business_branding" as PERMISSIVE for SELECT to "authenticated" using ((private.is_business_member(business_id) AND private.is_pro(business_id)));

create policy "branding_update" on "public"."business_branding" as PERMISSIVE for UPDATE to "authenticated" using ((private.has_business_role(business_id, ARRAY['owner'::text, 'admin'::text]) AND private.is_pro(business_id))) with check ((private.has_business_role(business_id, ARRAY['owner'::text, 'admin'::text]) AND private.is_pro(business_id)));

create policy "business_members_member_select" on "public"."business_members" as PERMISSIVE for SELECT to "public" using (private.is_business_member(business_id));

create policy "business_members_owner_admin_delete" on "public"."business_members" as PERMISSIVE for DELETE to "public" using (private.has_business_role(business_id, ARRAY['owner'::text, 'admin'::text]));

create policy "business_members_owner_admin_insert" on "public"."business_members" as PERMISSIVE for INSERT to "public" with check (private.has_business_role(business_id, ARRAY['owner'::text, 'admin'::text]));

create policy "business_members_owner_admin_update" on "public"."business_members" as PERMISSIVE for UPDATE to "public" using (private.has_business_role(business_id, ARRAY['owner'::text, 'admin'::text])) with check (private.has_business_role(business_id, ARRAY['owner'::text, 'admin'::text]));

create policy "velnu_services_owner_admin_insert" on "public"."business_service_interests" as PERMISSIVE for INSERT to "authenticated" with check ((private.has_business_role(business_id, ARRAY['owner'::text, 'admin'::text]) AND (updated_by = ( SELECT auth.uid() AS uid))));

create policy "velnu_services_owner_admin_select" on "public"."business_service_interests" as PERMISSIVE for SELECT to "authenticated" using (private.has_business_role(business_id, ARRAY['owner'::text, 'admin'::text]));

create policy "velnu_services_owner_admin_update" on "public"."business_service_interests" as PERMISSIVE for UPDATE to "authenticated" using (private.has_business_role(business_id, ARRAY['owner'::text, 'admin'::text])) with check ((private.has_business_role(business_id, ARRAY['owner'::text, 'admin'::text]) AND (updated_by = ( SELECT auth.uid() AS uid))));

create policy "settings_delete" on "public"."business_settings" as PERMISSIVE for DELETE to "authenticated" using (private.has_business_role(business_id, ARRAY['owner'::text, 'admin'::text]));

create policy "settings_insert" on "public"."business_settings" as PERMISSIVE for INSERT to "authenticated" with check (private.has_business_role(business_id, ARRAY['owner'::text, 'admin'::text]));

create policy "settings_read" on "public"."business_settings" as PERMISSIVE for SELECT to "authenticated" using (private.is_business_member(business_id));

create policy "settings_update" on "public"."business_settings" as PERMISSIVE for UPDATE to "authenticated" using (private.has_business_role(business_id, ARRAY['owner'::text, 'admin'::text])) with check (private.has_business_role(business_id, ARRAY['owner'::text, 'admin'::text]));

create policy "businesses_authenticated_insert" on "public"."businesses" as PERMISSIVE for INSERT to "authenticated" with check (((( SELECT auth.uid() AS uid) IS NOT NULL) AND ( SELECT private.velnu_has_accepted_terms() AS velnu_has_accepted_terms)));

create policy "businesses_member_select" on "public"."businesses" as PERMISSIVE for SELECT to "public" using ((private.is_business_member(id) OR (created_by_user_id = ( SELECT auth.uid() AS uid))));

create policy "businesses_owner_admin_update" on "public"."businesses" as PERMISSIVE for UPDATE to "public" using (private.has_business_role(id, ARRAY['owner'::text, 'admin'::text])) with check (private.has_business_role(id, ARRAY['owner'::text, 'admin'::text]));

create policy "change_order_items_member_select" on "public"."change_order_items" as PERMISSIVE for SELECT to "public" using (private.is_business_member(business_id));

create policy "change_order_items_writer_delete" on "public"."change_order_items" as PERMISSIVE for DELETE to "public" using (private.can_write_business(business_id));

create policy "change_order_items_writer_insert" on "public"."change_order_items" as PERMISSIVE for INSERT to "public" with check (private.can_write_business(business_id));

create policy "change_order_items_writer_update" on "public"."change_order_items" as PERMISSIVE for UPDATE to "public" using (private.can_write_business(business_id)) with check (private.can_write_business(business_id));

create policy "change_orders_member_select" on "public"."change_orders" as PERMISSIVE for SELECT to "public" using (private.is_business_member(business_id));

create policy "change_orders_writer_delete" on "public"."change_orders" as PERMISSIVE for DELETE to "public" using (private.can_write_business(business_id));

create policy "change_orders_writer_insert" on "public"."change_orders" as PERMISSIVE for INSERT to "public" with check (private.can_write_business(business_id));

create policy "change_orders_writer_update" on "public"."change_orders" as PERMISSIVE for UPDATE to "public" using (private.can_write_business(business_id)) with check (private.can_write_business(business_id));

create policy "customers_member_select" on "public"."customers" as PERMISSIVE for SELECT to "authenticated" using (private.is_business_member(business_id));

create policy "customers_writer_delete" on "public"."customers" as PERMISSIVE for DELETE to "authenticated" using (private.can_write_business(business_id));

create policy "customers_writer_insert" on "public"."customers" as PERMISSIVE for INSERT to "authenticated" with check (private.can_write_business(business_id));

create policy "customers_writer_update" on "public"."customers" as PERMISSIVE for UPDATE to "authenticated" using (private.can_write_business(business_id)) with check (private.can_write_business(business_id));

create policy "approval_pro_only" on "public"."document_approval_links" as RESTRICTIVE for INSERT to "authenticated" with check (private.is_pro(business_id));

create policy "document_approval_links_member_select" on "public"."document_approval_links" as PERMISSIVE for SELECT to "public" using (private.is_business_member(business_id));

create policy "document_approval_links_writer_insert" on "public"."document_approval_links" as PERMISSIVE for INSERT to "public" with check (private.can_write_business(business_id));

create policy "document_approval_links_writer_update" on "public"."document_approval_links" as PERMISSIVE for UPDATE to "public" using (private.can_write_business(business_id)) with check (private.can_write_business(business_id));

create policy "velnu_approval_paid_only" on "public"."document_approval_links" as RESTRICTIVE for INSERT to "authenticated" with check (private.is_pro(business_id));

create policy "document_approvals_member_select" on "public"."document_approvals" as PERMISSIVE for SELECT to "public" using (private.is_business_member(business_id));

create policy "estimate_items_member_select" on "public"."estimate_items" as PERMISSIVE for SELECT to "authenticated" using (private.is_business_member(business_id));

create policy "estimate_items_writer_delete" on "public"."estimate_items" as PERMISSIVE for DELETE to "authenticated" using (private.can_write_business(business_id));

create policy "estimate_items_writer_insert" on "public"."estimate_items" as PERMISSIVE for INSERT to "authenticated" with check (private.can_write_business(business_id));

create policy "estimate_items_writer_update" on "public"."estimate_items" as PERMISSIVE for UPDATE to "authenticated" using (private.can_write_business(business_id)) with check (private.can_write_business(business_id));

create policy "estimates_member_select" on "public"."estimates" as PERMISSIVE for SELECT to "authenticated" using (private.is_business_member(business_id));

create policy "estimates_writer_delete" on "public"."estimates" as PERMISSIVE for DELETE to "authenticated" using (private.can_write_business(business_id));

create policy "estimates_writer_insert" on "public"."estimates" as PERMISSIVE for INSERT to "authenticated" with check (private.can_write_business(business_id));

create policy "estimates_writer_update" on "public"."estimates" as PERMISSIVE for UPDATE to "authenticated" using (private.can_write_business(business_id)) with check (private.can_write_business(business_id));

create policy "invoice_items_member_select" on "public"."invoice_items" as PERMISSIVE for SELECT to "authenticated" using (private.is_business_member(business_id));

create policy "invoice_items_writer_delete" on "public"."invoice_items" as PERMISSIVE for DELETE to "authenticated" using (private.can_write_business(business_id));

create policy "invoice_items_writer_insert" on "public"."invoice_items" as PERMISSIVE for INSERT to "authenticated" with check (private.can_write_business(business_id));

create policy "invoice_items_writer_update" on "public"."invoice_items" as PERMISSIVE for UPDATE to "authenticated" using (private.can_write_business(business_id)) with check (private.can_write_business(business_id));

create policy "invoices_member_select" on "public"."invoices" as PERMISSIVE for SELECT to "authenticated" using (private.is_business_member(business_id));

create policy "invoices_writer_delete" on "public"."invoices" as PERMISSIVE for DELETE to "authenticated" using (private.can_write_business(business_id));

create policy "invoices_writer_insert" on "public"."invoices" as PERMISSIVE for INSERT to "authenticated" with check (private.can_write_business(business_id));

create policy "invoices_writer_update" on "public"."invoices" as PERMISSIVE for UPDATE to "authenticated" using (private.can_write_business(business_id)) with check (private.can_write_business(business_id));

create policy "jobs_member_select" on "public"."jobs" as PERMISSIVE for SELECT to "authenticated" using (private.is_business_member(business_id));

create policy "jobs_writer_delete" on "public"."jobs" as PERMISSIVE for DELETE to "authenticated" using (private.can_write_business(business_id));

create policy "jobs_writer_insert" on "public"."jobs" as PERMISSIVE for INSERT to "authenticated" with check (private.can_write_business(business_id));

create policy "jobs_writer_update" on "public"."jobs" as PERMISSIVE for UPDATE to "authenticated" using (private.can_write_business(business_id)) with check (private.can_write_business(business_id));

create policy "messages_member_select" on "public"."messages" as PERMISSIVE for SELECT to "authenticated" using (private.is_business_member(business_id));

create policy "messages_writer_delete" on "public"."messages" as PERMISSIVE for DELETE to "authenticated" using (private.can_write_business(business_id));

create policy "messages_writer_insert" on "public"."messages" as PERMISSIVE for INSERT to "authenticated" with check (private.can_write_business(business_id));

create policy "messages_writer_update" on "public"."messages" as PERMISSIVE for UPDATE to "authenticated" using (private.can_write_business(business_id)) with check (private.can_write_business(business_id));

create policy "payments_member_select" on "public"."payments" as PERMISSIVE for SELECT to "authenticated" using (private.is_business_member(business_id));

create policy "payments_writer_delete" on "public"."payments" as PERMISSIVE for DELETE to "authenticated" using (private.can_write_business(business_id));

create policy "payments_writer_insert" on "public"."payments" as PERMISSIVE for INSERT to "authenticated" with check (private.can_write_business(business_id));

create policy "payments_writer_update" on "public"."payments" as PERMISSIVE for UPDATE to "authenticated" using (private.can_write_business(business_id)) with check (private.can_write_business(business_id));

create policy "properties_member_select" on "public"."properties" as PERMISSIVE for SELECT to "authenticated" using (private.is_business_member(business_id));

create policy "properties_writer_delete" on "public"."properties" as PERMISSIVE for DELETE to "authenticated" using (private.can_write_business(business_id));

create policy "properties_writer_insert" on "public"."properties" as PERMISSIVE for INSERT to "authenticated" with check (private.can_write_business(business_id));

create policy "properties_writer_update" on "public"."properties" as PERMISSIVE for UPDATE to "authenticated" using (private.can_write_business(business_id)) with check (private.can_write_business(business_id));

create policy "quickbooks_transactions_finance_read" on "public"."quickbooks_transactions" as PERMISSIVE for SELECT to "authenticated" using (private.has_business_role(business_id, ARRAY['owner'::text, 'admin'::text, 'office'::text]));

create policy "reminders_member_select" on "public"."reminders" as PERMISSIVE for SELECT to "authenticated" using (private.is_business_member(business_id));

create policy "reminders_writer_delete" on "public"."reminders" as PERMISSIVE for DELETE to "authenticated" using (private.can_write_business(business_id));

create policy "reminders_writer_insert" on "public"."reminders" as PERMISSIVE for INSERT to "authenticated" with check (private.can_write_business(business_id));

create policy "reminders_writer_update" on "public"."reminders" as PERMISSIVE for UPDATE to "authenticated" using (private.can_write_business(business_id)) with check (private.can_write_business(business_id));

create policy "velnu_agreement_acceptance_insert" on "public"."user_agreement_acceptances" as PERMISSIVE for INSERT to "authenticated" with check (((user_id = ( SELECT auth.uid() AS uid)) AND (agreement_version = '2026-10-27-v3'::text) AND (terms_accepted = true) AND (ai_disclosure_acknowledged = true) AND (electronic_records_consent = true) AND (acceptance_method = 'checkbox_and_button'::text) AND (selected_tier_at_acceptance IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM user_plan_preferences p
  WHERE ((p.user_id = ( SELECT auth.uid() AS uid)) AND (p.selected_tier = user_agreement_acceptances.selected_tier_at_acceptance))))));

create policy "velnu_agreement_acceptance_read" on "public"."user_agreement_acceptances" as PERMISSIVE for SELECT to "authenticated" using ((user_id = ( SELECT auth.uid() AS uid)));

create policy "velnu_plan_preference_insert" on "public"."user_plan_preferences" as PERMISSIVE for INSERT to "authenticated" with check ((user_id = ( SELECT auth.uid() AS uid)));

create policy "velnu_plan_preference_read" on "public"."user_plan_preferences" as PERMISSIVE for SELECT to "authenticated" using ((user_id = ( SELECT auth.uid() AS uid)));

create policy "velnu_plan_preference_update" on "public"."user_plan_preferences" as PERMISSIVE for UPDATE to "authenticated" using ((user_id = ( SELECT auth.uid() AS uid))) with check ((user_id = ( SELECT auth.uid() AS uid)));

create policy "user_profiles_self_insert" on "public"."user_profiles" as PERMISSIVE for INSERT to "public" with check ((user_id = ( SELECT auth.uid() AS uid)));

create policy "user_profiles_self_select" on "public"."user_profiles" as PERMISSIVE for SELECT to "public" using ((user_id = ( SELECT auth.uid() AS uid)));

create policy "user_profiles_self_update" on "public"."user_profiles" as PERMISSIVE for UPDATE to "public" using ((user_id = ( SELECT auth.uid() AS uid))) with check ((user_id = ( SELECT auth.uid() AS uid)));

create policy "voice_transcriptions_member_all" on "public"."voice_transcriptions" as PERMISSIVE for ALL to "public" using ((private.is_business_member(business_id) AND (user_id = ( SELECT auth.uid() AS uid)))) with check ((private.is_business_member(business_id) AND (user_id = ( SELECT auth.uid() AS uid))));

create policy "velnu_business_logo_owner_delete" on "storage"."objects" as PERMISSIVE for DELETE to "authenticated" using (((bucket_id = 'velnu-business-logos'::text) AND (EXISTS ( SELECT 1
   FROM business_members m
  WHERE (((m.business_id)::text = split_part(objects.name, '/'::text, 1)) AND (m.user_id = ( SELECT auth.uid() AS uid)) AND (m.role = ANY (ARRAY['owner'::text, 'admin'::text])))))));

create policy "velnu_business_logo_owner_insert" on "storage"."objects" as PERMISSIVE for INSERT to "authenticated" with check (((bucket_id = 'velnu-business-logos'::text) AND (EXISTS ( SELECT 1
   FROM business_members m
  WHERE (((m.business_id)::text = split_part(objects.name, '/'::text, 1)) AND (m.user_id = ( SELECT auth.uid() AS uid)) AND (m.role = ANY (ARRAY['owner'::text, 'admin'::text])))))));

create policy "velnu_logo_paid_only" on "storage"."objects" as RESTRICTIVE for INSERT to "authenticated" with check (((bucket_id <> 'velnu-business-logos'::text) OR ((split_part(name, '/'::text, 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'::text) AND private.is_pro((split_part(name, '/'::text, 1))::uuid))));

revoke all on table "private"."business_entitlements" from PUBLIC, anon, authenticated, service_role;

grant INSERT on table "private"."business_entitlements" to "postgres";

grant SELECT on table "private"."business_entitlements" to "postgres";

grant UPDATE on table "private"."business_entitlements" to "postgres";

grant DELETE on table "private"."business_entitlements" to "postgres";

grant TRUNCATE on table "private"."business_entitlements" to "postgres";

grant REFERENCES on table "private"."business_entitlements" to "postgres";

grant TRIGGER on table "private"."business_entitlements" to "postgres";

grant MAINTAIN on table "private"."business_entitlements" to "postgres";

revoke all on table "private"."feature_requests" from PUBLIC, anon, authenticated, service_role;

grant INSERT on table "private"."feature_requests" to "postgres";

grant SELECT on table "private"."feature_requests" to "postgres";

grant UPDATE on table "private"."feature_requests" to "postgres";

grant DELETE on table "private"."feature_requests" to "postgres";

grant TRUNCATE on table "private"."feature_requests" to "postgres";

grant REFERENCES on table "private"."feature_requests" to "postgres";

grant TRIGGER on table "private"."feature_requests" to "postgres";

grant MAINTAIN on table "private"."feature_requests" to "postgres";

revoke all on table "private"."finviant_ai_attempt_budget" from PUBLIC, anon, authenticated, service_role;

grant INSERT on table "private"."finviant_ai_attempt_budget" to "postgres";

grant SELECT on table "private"."finviant_ai_attempt_budget" to "postgres";

grant UPDATE on table "private"."finviant_ai_attempt_budget" to "postgres";

grant DELETE on table "private"."finviant_ai_attempt_budget" to "postgres";

grant TRUNCATE on table "private"."finviant_ai_attempt_budget" to "postgres";

grant REFERENCES on table "private"."finviant_ai_attempt_budget" to "postgres";

grant TRIGGER on table "private"."finviant_ai_attempt_budget" to "postgres";

grant MAINTAIN on table "private"."finviant_ai_attempt_budget" to "postgres";

comment on table "private"."finviant_ai_attempt_budget" is 'Conservative pre-provider attempt budget: failed and uncertain calls remain counted. Not a dollar-denominated billing ledger.';

revoke all on table "private"."finviant_delivery_events" from PUBLIC, anon, authenticated, service_role;

grant INSERT on table "private"."finviant_delivery_events" to "postgres";

grant SELECT on table "private"."finviant_delivery_events" to "postgres";

grant UPDATE on table "private"."finviant_delivery_events" to "postgres";

grant DELETE on table "private"."finviant_delivery_events" to "postgres";

grant TRUNCATE on table "private"."finviant_delivery_events" to "postgres";

grant REFERENCES on table "private"."finviant_delivery_events" to "postgres";

grant TRIGGER on table "private"."finviant_delivery_events" to "postgres";

grant MAINTAIN on table "private"."finviant_delivery_events" to "postgres";

revoke all on table "private"."finviant_email_outbox" from PUBLIC, anon, authenticated, service_role;

grant INSERT on table "private"."finviant_email_outbox" to "postgres";

grant SELECT on table "private"."finviant_email_outbox" to "postgres";

grant UPDATE on table "private"."finviant_email_outbox" to "postgres";

grant DELETE on table "private"."finviant_email_outbox" to "postgres";

grant TRUNCATE on table "private"."finviant_email_outbox" to "postgres";

grant REFERENCES on table "private"."finviant_email_outbox" to "postgres";

grant TRIGGER on table "private"."finviant_email_outbox" to "postgres";

grant MAINTAIN on table "private"."finviant_email_outbox" to "postgres";

revoke all on table "private"."finviant_payment_events" from PUBLIC, anon, authenticated, service_role;

grant INSERT on table "private"."finviant_payment_events" to "postgres";

grant SELECT on table "private"."finviant_payment_events" to "postgres";

grant UPDATE on table "private"."finviant_payment_events" to "postgres";

grant DELETE on table "private"."finviant_payment_events" to "postgres";

grant TRUNCATE on table "private"."finviant_payment_events" to "postgres";

grant REFERENCES on table "private"."finviant_payment_events" to "postgres";

grant TRIGGER on table "private"."finviant_payment_events" to "postgres";

grant MAINTAIN on table "private"."finviant_payment_events" to "postgres";

comment on table "private"."finviant_payment_events" is 'Sandbox-only signed event inbox; never grants entitlements or moves money. Canonical reconciliation requires separately validated Stripe mapping and credentials.';

revoke all on table "private"."monthly_usage" from PUBLIC, anon, authenticated, service_role;

grant INSERT on table "private"."monthly_usage" to "postgres";

grant SELECT on table "private"."monthly_usage" to "postgres";

grant UPDATE on table "private"."monthly_usage" to "postgres";

grant DELETE on table "private"."monthly_usage" to "postgres";

grant TRUNCATE on table "private"."monthly_usage" to "postgres";

grant REFERENCES on table "private"."monthly_usage" to "postgres";

grant TRIGGER on table "private"."monthly_usage" to "postgres";

grant MAINTAIN on table "private"."monthly_usage" to "postgres";

revoke all on table "public"."ai_actions" from PUBLIC, anon, authenticated, service_role;

grant INSERT on table "public"."ai_actions" to "postgres";

grant SELECT on table "public"."ai_actions" to "postgres";

grant UPDATE on table "public"."ai_actions" to "postgres";

grant DELETE on table "public"."ai_actions" to "postgres";

grant TRUNCATE on table "public"."ai_actions" to "postgres";

grant REFERENCES on table "public"."ai_actions" to "postgres";

grant TRIGGER on table "public"."ai_actions" to "postgres";

grant MAINTAIN on table "public"."ai_actions" to "postgres";

grant SELECT on table "public"."ai_actions" to "authenticated";

grant MAINTAIN on table "public"."ai_actions" to "authenticated";

grant INSERT on table "public"."ai_actions" to "service_role";

grant SELECT on table "public"."ai_actions" to "service_role";

grant UPDATE on table "public"."ai_actions" to "service_role";

grant DELETE on table "public"."ai_actions" to "service_role";

grant TRUNCATE on table "public"."ai_actions" to "service_role";

grant REFERENCES on table "public"."ai_actions" to "service_role";

grant TRIGGER on table "public"."ai_actions" to "service_role";

grant MAINTAIN on table "public"."ai_actions" to "service_role";

revoke all on table "public"."appointments" from PUBLIC, anon, authenticated, service_role;

grant INSERT on table "public"."appointments" to "postgres";

grant SELECT on table "public"."appointments" to "postgres";

grant UPDATE on table "public"."appointments" to "postgres";

grant DELETE on table "public"."appointments" to "postgres";

grant TRUNCATE on table "public"."appointments" to "postgres";

grant REFERENCES on table "public"."appointments" to "postgres";

grant TRIGGER on table "public"."appointments" to "postgres";

grant MAINTAIN on table "public"."appointments" to "postgres";

grant INSERT on table "public"."appointments" to "anon";

grant SELECT on table "public"."appointments" to "anon";

grant UPDATE on table "public"."appointments" to "anon";

grant DELETE on table "public"."appointments" to "anon";

grant MAINTAIN on table "public"."appointments" to "anon";

grant INSERT on table "public"."appointments" to "authenticated";

grant SELECT on table "public"."appointments" to "authenticated";

grant UPDATE on table "public"."appointments" to "authenticated";

grant DELETE on table "public"."appointments" to "authenticated";

grant MAINTAIN on table "public"."appointments" to "authenticated";

grant INSERT on table "public"."appointments" to "service_role";

grant SELECT on table "public"."appointments" to "service_role";

grant UPDATE on table "public"."appointments" to "service_role";

grant DELETE on table "public"."appointments" to "service_role";

grant TRUNCATE on table "public"."appointments" to "service_role";

grant REFERENCES on table "public"."appointments" to "service_role";

grant TRIGGER on table "public"."appointments" to "service_role";

grant MAINTAIN on table "public"."appointments" to "service_role";

revoke all on table "public"."bookkeeping_entries" from PUBLIC, anon, authenticated, service_role;

grant INSERT on table "public"."bookkeeping_entries" to "postgres";

grant SELECT on table "public"."bookkeeping_entries" to "postgres";

grant UPDATE on table "public"."bookkeeping_entries" to "postgres";

grant DELETE on table "public"."bookkeeping_entries" to "postgres";

grant TRUNCATE on table "public"."bookkeeping_entries" to "postgres";

grant REFERENCES on table "public"."bookkeeping_entries" to "postgres";

grant TRIGGER on table "public"."bookkeeping_entries" to "postgres";

grant MAINTAIN on table "public"."bookkeeping_entries" to "postgres";

grant INSERT on table "public"."bookkeeping_entries" to "service_role";

grant SELECT on table "public"."bookkeeping_entries" to "service_role";

grant UPDATE on table "public"."bookkeeping_entries" to "service_role";

grant DELETE on table "public"."bookkeeping_entries" to "service_role";

grant TRUNCATE on table "public"."bookkeeping_entries" to "service_role";

grant REFERENCES on table "public"."bookkeeping_entries" to "service_role";

grant TRIGGER on table "public"."bookkeeping_entries" to "service_role";

grant MAINTAIN on table "public"."bookkeeping_entries" to "service_role";

grant INSERT on table "public"."bookkeeping_entries" to "authenticated";

grant SELECT on table "public"."bookkeeping_entries" to "authenticated";

grant DELETE on table "public"."bookkeeping_entries" to "authenticated";

comment on table "public"."bookkeeping_entries" is 'User-entered income and expenses that are not generated by Velnu invoices, with tenant-scoped finance access.';

revoke all on table "public"."business_branding" from PUBLIC, anon, authenticated, service_role;

grant INSERT on table "public"."business_branding" to "postgres";

grant SELECT on table "public"."business_branding" to "postgres";

grant UPDATE on table "public"."business_branding" to "postgres";

grant DELETE on table "public"."business_branding" to "postgres";

grant TRUNCATE on table "public"."business_branding" to "postgres";

grant REFERENCES on table "public"."business_branding" to "postgres";

grant TRIGGER on table "public"."business_branding" to "postgres";

grant MAINTAIN on table "public"."business_branding" to "postgres";

grant INSERT on table "public"."business_branding" to "anon";

grant SELECT on table "public"."business_branding" to "anon";

grant UPDATE on table "public"."business_branding" to "anon";

grant DELETE on table "public"."business_branding" to "anon";

grant MAINTAIN on table "public"."business_branding" to "anon";

grant INSERT on table "public"."business_branding" to "authenticated";

grant SELECT on table "public"."business_branding" to "authenticated";

grant UPDATE on table "public"."business_branding" to "authenticated";

grant DELETE on table "public"."business_branding" to "authenticated";

grant MAINTAIN on table "public"."business_branding" to "authenticated";

grant INSERT on table "public"."business_branding" to "service_role";

grant SELECT on table "public"."business_branding" to "service_role";

grant UPDATE on table "public"."business_branding" to "service_role";

grant DELETE on table "public"."business_branding" to "service_role";

grant TRUNCATE on table "public"."business_branding" to "service_role";

grant REFERENCES on table "public"."business_branding" to "service_role";

grant TRIGGER on table "public"."business_branding" to "service_role";

grant MAINTAIN on table "public"."business_branding" to "service_role";

revoke all on table "public"."business_members" from PUBLIC, anon, authenticated, service_role;

grant INSERT on table "public"."business_members" to "postgres";

grant SELECT on table "public"."business_members" to "postgres";

grant UPDATE on table "public"."business_members" to "postgres";

grant DELETE on table "public"."business_members" to "postgres";

grant TRUNCATE on table "public"."business_members" to "postgres";

grant REFERENCES on table "public"."business_members" to "postgres";

grant TRIGGER on table "public"."business_members" to "postgres";

grant MAINTAIN on table "public"."business_members" to "postgres";

grant INSERT on table "public"."business_members" to "anon";

grant SELECT on table "public"."business_members" to "anon";

grant UPDATE on table "public"."business_members" to "anon";

grant DELETE on table "public"."business_members" to "anon";

grant MAINTAIN on table "public"."business_members" to "anon";

grant INSERT on table "public"."business_members" to "authenticated";

grant SELECT on table "public"."business_members" to "authenticated";

grant UPDATE on table "public"."business_members" to "authenticated";

grant DELETE on table "public"."business_members" to "authenticated";

grant MAINTAIN on table "public"."business_members" to "authenticated";

grant INSERT on table "public"."business_members" to "service_role";

grant SELECT on table "public"."business_members" to "service_role";

grant UPDATE on table "public"."business_members" to "service_role";

grant DELETE on table "public"."business_members" to "service_role";

grant TRUNCATE on table "public"."business_members" to "service_role";

grant REFERENCES on table "public"."business_members" to "service_role";

grant TRIGGER on table "public"."business_members" to "service_role";

grant MAINTAIN on table "public"."business_members" to "service_role";

revoke all on table "public"."business_service_interests" from PUBLIC, anon, authenticated, service_role;

grant INSERT on table "public"."business_service_interests" to "postgres";

grant SELECT on table "public"."business_service_interests" to "postgres";

grant UPDATE on table "public"."business_service_interests" to "postgres";

grant DELETE on table "public"."business_service_interests" to "postgres";

grant TRUNCATE on table "public"."business_service_interests" to "postgres";

grant REFERENCES on table "public"."business_service_interests" to "postgres";

grant TRIGGER on table "public"."business_service_interests" to "postgres";

grant MAINTAIN on table "public"."business_service_interests" to "postgres";

grant INSERT on table "public"."business_service_interests" to "anon";

grant SELECT on table "public"."business_service_interests" to "anon";

grant UPDATE on table "public"."business_service_interests" to "anon";

grant DELETE on table "public"."business_service_interests" to "anon";

grant TRUNCATE on table "public"."business_service_interests" to "anon";

grant REFERENCES on table "public"."business_service_interests" to "anon";

grant TRIGGER on table "public"."business_service_interests" to "anon";

grant MAINTAIN on table "public"."business_service_interests" to "anon";

grant INSERT on table "public"."business_service_interests" to "authenticated";

grant SELECT on table "public"."business_service_interests" to "authenticated";

grant UPDATE on table "public"."business_service_interests" to "authenticated";

grant DELETE on table "public"."business_service_interests" to "authenticated";

grant TRUNCATE on table "public"."business_service_interests" to "authenticated";

grant REFERENCES on table "public"."business_service_interests" to "authenticated";

grant TRIGGER on table "public"."business_service_interests" to "authenticated";

grant MAINTAIN on table "public"."business_service_interests" to "authenticated";

grant INSERT on table "public"."business_service_interests" to "service_role";

grant SELECT on table "public"."business_service_interests" to "service_role";

grant UPDATE on table "public"."business_service_interests" to "service_role";

grant DELETE on table "public"."business_service_interests" to "service_role";

grant TRUNCATE on table "public"."business_service_interests" to "service_role";

grant REFERENCES on table "public"."business_service_interests" to "service_role";

grant TRIGGER on table "public"."business_service_interests" to "service_role";

grant MAINTAIN on table "public"."business_service_interests" to "service_role";

comment on table "public"."business_service_interests" is 'Non-billable service and plan interests only. Not entitlements, payments, or feature access grants.';

revoke all on table "public"."business_settings" from PUBLIC, anon, authenticated, service_role;

grant INSERT on table "public"."business_settings" to "postgres";

grant SELECT on table "public"."business_settings" to "postgres";

grant UPDATE on table "public"."business_settings" to "postgres";

grant DELETE on table "public"."business_settings" to "postgres";

grant TRUNCATE on table "public"."business_settings" to "postgres";

grant REFERENCES on table "public"."business_settings" to "postgres";

grant TRIGGER on table "public"."business_settings" to "postgres";

grant MAINTAIN on table "public"."business_settings" to "postgres";

grant INSERT on table "public"."business_settings" to "anon";

grant SELECT on table "public"."business_settings" to "anon";

grant UPDATE on table "public"."business_settings" to "anon";

grant DELETE on table "public"."business_settings" to "anon";

grant MAINTAIN on table "public"."business_settings" to "anon";

grant INSERT on table "public"."business_settings" to "authenticated";

grant SELECT on table "public"."business_settings" to "authenticated";

grant UPDATE on table "public"."business_settings" to "authenticated";

grant DELETE on table "public"."business_settings" to "authenticated";

grant MAINTAIN on table "public"."business_settings" to "authenticated";

grant INSERT on table "public"."business_settings" to "service_role";

grant SELECT on table "public"."business_settings" to "service_role";

grant UPDATE on table "public"."business_settings" to "service_role";

grant DELETE on table "public"."business_settings" to "service_role";

grant TRUNCATE on table "public"."business_settings" to "service_role";

grant REFERENCES on table "public"."business_settings" to "service_role";

grant TRIGGER on table "public"."business_settings" to "service_role";

grant MAINTAIN on table "public"."business_settings" to "service_role";

revoke all on table "public"."businesses" from PUBLIC, anon, authenticated, service_role;

grant INSERT on table "public"."businesses" to "postgres";

grant SELECT on table "public"."businesses" to "postgres";

grant UPDATE on table "public"."businesses" to "postgres";

grant DELETE on table "public"."businesses" to "postgres";

grant TRUNCATE on table "public"."businesses" to "postgres";

grant REFERENCES on table "public"."businesses" to "postgres";

grant TRIGGER on table "public"."businesses" to "postgres";

grant MAINTAIN on table "public"."businesses" to "postgres";

grant INSERT on table "public"."businesses" to "anon";

grant SELECT on table "public"."businesses" to "anon";

grant UPDATE on table "public"."businesses" to "anon";

grant DELETE on table "public"."businesses" to "anon";

grant MAINTAIN on table "public"."businesses" to "anon";

grant INSERT on table "public"."businesses" to "authenticated";

grant SELECT on table "public"."businesses" to "authenticated";

grant UPDATE on table "public"."businesses" to "authenticated";

grant DELETE on table "public"."businesses" to "authenticated";

grant MAINTAIN on table "public"."businesses" to "authenticated";

grant INSERT on table "public"."businesses" to "service_role";

grant SELECT on table "public"."businesses" to "service_role";

grant UPDATE on table "public"."businesses" to "service_role";

grant DELETE on table "public"."businesses" to "service_role";

grant TRUNCATE on table "public"."businesses" to "service_role";

grant REFERENCES on table "public"."businesses" to "service_role";

grant TRIGGER on table "public"."businesses" to "service_role";

grant MAINTAIN on table "public"."businesses" to "service_role";

revoke all on table "public"."change_order_items" from PUBLIC, anon, authenticated, service_role;

grant INSERT on table "public"."change_order_items" to "postgres";

grant SELECT on table "public"."change_order_items" to "postgres";

grant UPDATE on table "public"."change_order_items" to "postgres";

grant DELETE on table "public"."change_order_items" to "postgres";

grant TRUNCATE on table "public"."change_order_items" to "postgres";

grant REFERENCES on table "public"."change_order_items" to "postgres";

grant TRIGGER on table "public"."change_order_items" to "postgres";

grant MAINTAIN on table "public"."change_order_items" to "postgres";

grant INSERT on table "public"."change_order_items" to "anon";

grant SELECT on table "public"."change_order_items" to "anon";

grant UPDATE on table "public"."change_order_items" to "anon";

grant DELETE on table "public"."change_order_items" to "anon";

grant MAINTAIN on table "public"."change_order_items" to "anon";

grant INSERT on table "public"."change_order_items" to "authenticated";

grant SELECT on table "public"."change_order_items" to "authenticated";

grant UPDATE on table "public"."change_order_items" to "authenticated";

grant DELETE on table "public"."change_order_items" to "authenticated";

grant MAINTAIN on table "public"."change_order_items" to "authenticated";

grant INSERT on table "public"."change_order_items" to "service_role";

grant SELECT on table "public"."change_order_items" to "service_role";

grant UPDATE on table "public"."change_order_items" to "service_role";

grant DELETE on table "public"."change_order_items" to "service_role";

grant TRUNCATE on table "public"."change_order_items" to "service_role";

grant REFERENCES on table "public"."change_order_items" to "service_role";

grant TRIGGER on table "public"."change_order_items" to "service_role";

grant MAINTAIN on table "public"."change_order_items" to "service_role";

revoke all on table "public"."change_orders" from PUBLIC, anon, authenticated, service_role;

grant INSERT on table "public"."change_orders" to "postgres";

grant SELECT on table "public"."change_orders" to "postgres";

grant UPDATE on table "public"."change_orders" to "postgres";

grant DELETE on table "public"."change_orders" to "postgres";

grant TRUNCATE on table "public"."change_orders" to "postgres";

grant REFERENCES on table "public"."change_orders" to "postgres";

grant TRIGGER on table "public"."change_orders" to "postgres";

grant MAINTAIN on table "public"."change_orders" to "postgres";

grant INSERT on table "public"."change_orders" to "anon";

grant SELECT on table "public"."change_orders" to "anon";

grant UPDATE on table "public"."change_orders" to "anon";

grant DELETE on table "public"."change_orders" to "anon";

grant MAINTAIN on table "public"."change_orders" to "anon";

grant INSERT on table "public"."change_orders" to "authenticated";

grant SELECT on table "public"."change_orders" to "authenticated";

grant UPDATE on table "public"."change_orders" to "authenticated";

grant DELETE on table "public"."change_orders" to "authenticated";

grant MAINTAIN on table "public"."change_orders" to "authenticated";

grant INSERT on table "public"."change_orders" to "service_role";

grant SELECT on table "public"."change_orders" to "service_role";

grant UPDATE on table "public"."change_orders" to "service_role";

grant DELETE on table "public"."change_orders" to "service_role";

grant TRUNCATE on table "public"."change_orders" to "service_role";

grant REFERENCES on table "public"."change_orders" to "service_role";

grant TRIGGER on table "public"."change_orders" to "service_role";

grant MAINTAIN on table "public"."change_orders" to "service_role";

revoke all on table "public"."customers" from PUBLIC, anon, authenticated, service_role;

grant INSERT on table "public"."customers" to "postgres";

grant SELECT on table "public"."customers" to "postgres";

grant UPDATE on table "public"."customers" to "postgres";

grant DELETE on table "public"."customers" to "postgres";

grant TRUNCATE on table "public"."customers" to "postgres";

grant REFERENCES on table "public"."customers" to "postgres";

grant TRIGGER on table "public"."customers" to "postgres";

grant MAINTAIN on table "public"."customers" to "postgres";

grant INSERT on table "public"."customers" to "anon";

grant SELECT on table "public"."customers" to "anon";

grant UPDATE on table "public"."customers" to "anon";

grant DELETE on table "public"."customers" to "anon";

grant MAINTAIN on table "public"."customers" to "anon";

grant INSERT on table "public"."customers" to "authenticated";

grant SELECT on table "public"."customers" to "authenticated";

grant UPDATE on table "public"."customers" to "authenticated";

grant DELETE on table "public"."customers" to "authenticated";

grant MAINTAIN on table "public"."customers" to "authenticated";

grant INSERT on table "public"."customers" to "service_role";

grant SELECT on table "public"."customers" to "service_role";

grant UPDATE on table "public"."customers" to "service_role";

grant DELETE on table "public"."customers" to "service_role";

grant TRUNCATE on table "public"."customers" to "service_role";

grant REFERENCES on table "public"."customers" to "service_role";

grant TRIGGER on table "public"."customers" to "service_role";

grant MAINTAIN on table "public"."customers" to "service_role";

revoke all on table "public"."document_approval_links" from PUBLIC, anon, authenticated, service_role;

grant INSERT on table "public"."document_approval_links" to "postgres";

grant SELECT on table "public"."document_approval_links" to "postgres";

grant UPDATE on table "public"."document_approval_links" to "postgres";

grant DELETE on table "public"."document_approval_links" to "postgres";

grant TRUNCATE on table "public"."document_approval_links" to "postgres";

grant REFERENCES on table "public"."document_approval_links" to "postgres";

grant TRIGGER on table "public"."document_approval_links" to "postgres";

grant MAINTAIN on table "public"."document_approval_links" to "postgres";

grant INSERT on table "public"."document_approval_links" to "anon";

grant SELECT on table "public"."document_approval_links" to "anon";

grant UPDATE on table "public"."document_approval_links" to "anon";

grant DELETE on table "public"."document_approval_links" to "anon";

grant MAINTAIN on table "public"."document_approval_links" to "anon";

grant INSERT on table "public"."document_approval_links" to "authenticated";

grant SELECT on table "public"."document_approval_links" to "authenticated";

grant UPDATE on table "public"."document_approval_links" to "authenticated";

grant DELETE on table "public"."document_approval_links" to "authenticated";

grant MAINTAIN on table "public"."document_approval_links" to "authenticated";

grant INSERT on table "public"."document_approval_links" to "service_role";

grant SELECT on table "public"."document_approval_links" to "service_role";

grant UPDATE on table "public"."document_approval_links" to "service_role";

grant DELETE on table "public"."document_approval_links" to "service_role";

grant TRUNCATE on table "public"."document_approval_links" to "service_role";

grant REFERENCES on table "public"."document_approval_links" to "service_role";

grant TRIGGER on table "public"."document_approval_links" to "service_role";

grant MAINTAIN on table "public"."document_approval_links" to "service_role";

revoke all on table "public"."document_approvals" from PUBLIC, anon, authenticated, service_role;

grant INSERT on table "public"."document_approvals" to "postgres";

grant SELECT on table "public"."document_approvals" to "postgres";

grant UPDATE on table "public"."document_approvals" to "postgres";

grant DELETE on table "public"."document_approvals" to "postgres";

grant TRUNCATE on table "public"."document_approvals" to "postgres";

grant REFERENCES on table "public"."document_approvals" to "postgres";

grant TRIGGER on table "public"."document_approvals" to "postgres";

grant MAINTAIN on table "public"."document_approvals" to "postgres";

grant INSERT on table "public"."document_approvals" to "anon";

grant SELECT on table "public"."document_approvals" to "anon";

grant UPDATE on table "public"."document_approvals" to "anon";

grant DELETE on table "public"."document_approvals" to "anon";

grant MAINTAIN on table "public"."document_approvals" to "anon";

grant INSERT on table "public"."document_approvals" to "authenticated";

grant SELECT on table "public"."document_approvals" to "authenticated";

grant UPDATE on table "public"."document_approvals" to "authenticated";

grant DELETE on table "public"."document_approvals" to "authenticated";

grant MAINTAIN on table "public"."document_approvals" to "authenticated";

grant INSERT on table "public"."document_approvals" to "service_role";

grant SELECT on table "public"."document_approvals" to "service_role";

grant UPDATE on table "public"."document_approvals" to "service_role";

grant DELETE on table "public"."document_approvals" to "service_role";

grant TRUNCATE on table "public"."document_approvals" to "service_role";

grant REFERENCES on table "public"."document_approvals" to "service_role";

grant TRIGGER on table "public"."document_approvals" to "service_role";

grant MAINTAIN on table "public"."document_approvals" to "service_role";

revoke all on table "public"."estimate_items" from PUBLIC, anon, authenticated, service_role;

grant INSERT on table "public"."estimate_items" to "postgres";

grant SELECT on table "public"."estimate_items" to "postgres";

grant UPDATE on table "public"."estimate_items" to "postgres";

grant DELETE on table "public"."estimate_items" to "postgres";

grant TRUNCATE on table "public"."estimate_items" to "postgres";

grant REFERENCES on table "public"."estimate_items" to "postgres";

grant TRIGGER on table "public"."estimate_items" to "postgres";

grant MAINTAIN on table "public"."estimate_items" to "postgres";

grant INSERT on table "public"."estimate_items" to "anon";

grant SELECT on table "public"."estimate_items" to "anon";

grant UPDATE on table "public"."estimate_items" to "anon";

grant DELETE on table "public"."estimate_items" to "anon";

grant MAINTAIN on table "public"."estimate_items" to "anon";

grant INSERT on table "public"."estimate_items" to "authenticated";

grant SELECT on table "public"."estimate_items" to "authenticated";

grant UPDATE on table "public"."estimate_items" to "authenticated";

grant DELETE on table "public"."estimate_items" to "authenticated";

grant MAINTAIN on table "public"."estimate_items" to "authenticated";

grant INSERT on table "public"."estimate_items" to "service_role";

grant SELECT on table "public"."estimate_items" to "service_role";

grant UPDATE on table "public"."estimate_items" to "service_role";

grant DELETE on table "public"."estimate_items" to "service_role";

grant TRUNCATE on table "public"."estimate_items" to "service_role";

grant REFERENCES on table "public"."estimate_items" to "service_role";

grant TRIGGER on table "public"."estimate_items" to "service_role";

grant MAINTAIN on table "public"."estimate_items" to "service_role";

revoke all on table "public"."estimates" from PUBLIC, anon, authenticated, service_role;

grant INSERT on table "public"."estimates" to "postgres";

grant SELECT on table "public"."estimates" to "postgres";

grant UPDATE on table "public"."estimates" to "postgres";

grant DELETE on table "public"."estimates" to "postgres";

grant TRUNCATE on table "public"."estimates" to "postgres";

grant REFERENCES on table "public"."estimates" to "postgres";

grant TRIGGER on table "public"."estimates" to "postgres";

grant MAINTAIN on table "public"."estimates" to "postgres";

grant INSERT on table "public"."estimates" to "anon";

grant SELECT on table "public"."estimates" to "anon";

grant UPDATE on table "public"."estimates" to "anon";

grant DELETE on table "public"."estimates" to "anon";

grant MAINTAIN on table "public"."estimates" to "anon";

grant INSERT on table "public"."estimates" to "authenticated";

grant SELECT on table "public"."estimates" to "authenticated";

grant UPDATE on table "public"."estimates" to "authenticated";

grant DELETE on table "public"."estimates" to "authenticated";

grant MAINTAIN on table "public"."estimates" to "authenticated";

grant INSERT on table "public"."estimates" to "service_role";

grant SELECT on table "public"."estimates" to "service_role";

grant UPDATE on table "public"."estimates" to "service_role";

grant DELETE on table "public"."estimates" to "service_role";

grant TRUNCATE on table "public"."estimates" to "service_role";

grant REFERENCES on table "public"."estimates" to "service_role";

grant TRIGGER on table "public"."estimates" to "service_role";

grant MAINTAIN on table "public"."estimates" to "service_role";

revoke all on table "public"."invoice_items" from PUBLIC, anon, authenticated, service_role;

grant INSERT on table "public"."invoice_items" to "postgres";

grant SELECT on table "public"."invoice_items" to "postgres";

grant UPDATE on table "public"."invoice_items" to "postgres";

grant DELETE on table "public"."invoice_items" to "postgres";

grant TRUNCATE on table "public"."invoice_items" to "postgres";

grant REFERENCES on table "public"."invoice_items" to "postgres";

grant TRIGGER on table "public"."invoice_items" to "postgres";

grant MAINTAIN on table "public"."invoice_items" to "postgres";

grant INSERT on table "public"."invoice_items" to "anon";

grant SELECT on table "public"."invoice_items" to "anon";

grant UPDATE on table "public"."invoice_items" to "anon";

grant DELETE on table "public"."invoice_items" to "anon";

grant MAINTAIN on table "public"."invoice_items" to "anon";

grant INSERT on table "public"."invoice_items" to "authenticated";

grant SELECT on table "public"."invoice_items" to "authenticated";

grant UPDATE on table "public"."invoice_items" to "authenticated";

grant DELETE on table "public"."invoice_items" to "authenticated";

grant MAINTAIN on table "public"."invoice_items" to "authenticated";

grant INSERT on table "public"."invoice_items" to "service_role";

grant SELECT on table "public"."invoice_items" to "service_role";

grant UPDATE on table "public"."invoice_items" to "service_role";

grant DELETE on table "public"."invoice_items" to "service_role";

grant TRUNCATE on table "public"."invoice_items" to "service_role";

grant REFERENCES on table "public"."invoice_items" to "service_role";

grant TRIGGER on table "public"."invoice_items" to "service_role";

grant MAINTAIN on table "public"."invoice_items" to "service_role";

revoke all on table "public"."invoices" from PUBLIC, anon, authenticated, service_role;

grant INSERT on table "public"."invoices" to "postgres";

grant SELECT on table "public"."invoices" to "postgres";

grant UPDATE on table "public"."invoices" to "postgres";

grant DELETE on table "public"."invoices" to "postgres";

grant TRUNCATE on table "public"."invoices" to "postgres";

grant REFERENCES on table "public"."invoices" to "postgres";

grant TRIGGER on table "public"."invoices" to "postgres";

grant MAINTAIN on table "public"."invoices" to "postgres";

grant INSERT on table "public"."invoices" to "anon";

grant SELECT on table "public"."invoices" to "anon";

grant UPDATE on table "public"."invoices" to "anon";

grant DELETE on table "public"."invoices" to "anon";

grant MAINTAIN on table "public"."invoices" to "anon";

grant INSERT on table "public"."invoices" to "authenticated";

grant SELECT on table "public"."invoices" to "authenticated";

grant UPDATE on table "public"."invoices" to "authenticated";

grant DELETE on table "public"."invoices" to "authenticated";

grant MAINTAIN on table "public"."invoices" to "authenticated";

grant INSERT on table "public"."invoices" to "service_role";

grant SELECT on table "public"."invoices" to "service_role";

grant UPDATE on table "public"."invoices" to "service_role";

grant DELETE on table "public"."invoices" to "service_role";

grant TRUNCATE on table "public"."invoices" to "service_role";

grant REFERENCES on table "public"."invoices" to "service_role";

grant TRIGGER on table "public"."invoices" to "service_role";

grant MAINTAIN on table "public"."invoices" to "service_role";

revoke all on table "public"."jobs" from PUBLIC, anon, authenticated, service_role;

grant INSERT on table "public"."jobs" to "postgres";

grant SELECT on table "public"."jobs" to "postgres";

grant UPDATE on table "public"."jobs" to "postgres";

grant DELETE on table "public"."jobs" to "postgres";

grant TRUNCATE on table "public"."jobs" to "postgres";

grant REFERENCES on table "public"."jobs" to "postgres";

grant TRIGGER on table "public"."jobs" to "postgres";

grant MAINTAIN on table "public"."jobs" to "postgres";

grant INSERT on table "public"."jobs" to "anon";

grant SELECT on table "public"."jobs" to "anon";

grant UPDATE on table "public"."jobs" to "anon";

grant DELETE on table "public"."jobs" to "anon";

grant MAINTAIN on table "public"."jobs" to "anon";

grant INSERT on table "public"."jobs" to "authenticated";

grant SELECT on table "public"."jobs" to "authenticated";

grant UPDATE on table "public"."jobs" to "authenticated";

grant DELETE on table "public"."jobs" to "authenticated";

grant MAINTAIN on table "public"."jobs" to "authenticated";

grant INSERT on table "public"."jobs" to "service_role";

grant SELECT on table "public"."jobs" to "service_role";

grant UPDATE on table "public"."jobs" to "service_role";

grant DELETE on table "public"."jobs" to "service_role";

grant TRUNCATE on table "public"."jobs" to "service_role";

grant REFERENCES on table "public"."jobs" to "service_role";

grant TRIGGER on table "public"."jobs" to "service_role";

grant MAINTAIN on table "public"."jobs" to "service_role";

revoke all on table "public"."messages" from PUBLIC, anon, authenticated, service_role;

grant INSERT on table "public"."messages" to "postgres";

grant SELECT on table "public"."messages" to "postgres";

grant UPDATE on table "public"."messages" to "postgres";

grant DELETE on table "public"."messages" to "postgres";

grant TRUNCATE on table "public"."messages" to "postgres";

grant REFERENCES on table "public"."messages" to "postgres";

grant TRIGGER on table "public"."messages" to "postgres";

grant MAINTAIN on table "public"."messages" to "postgres";

grant SELECT on table "public"."messages" to "anon";

grant MAINTAIN on table "public"."messages" to "anon";

grant SELECT on table "public"."messages" to "authenticated";

grant MAINTAIN on table "public"."messages" to "authenticated";

grant INSERT on table "public"."messages" to "service_role";

grant SELECT on table "public"."messages" to "service_role";

grant UPDATE on table "public"."messages" to "service_role";

grant DELETE on table "public"."messages" to "service_role";

grant TRUNCATE on table "public"."messages" to "service_role";

grant REFERENCES on table "public"."messages" to "service_role";

grant TRIGGER on table "public"."messages" to "service_role";

grant MAINTAIN on table "public"."messages" to "service_role";

comment on table "public"."messages" is 'Workspace-visible communication activity; delivery state is written only by the authorized backend and verified provider receipts. Existing tenant RLS remains in effect.';

revoke all on table "public"."payments" from PUBLIC, anon, authenticated, service_role;

grant INSERT on table "public"."payments" to "postgres";

grant SELECT on table "public"."payments" to "postgres";

grant UPDATE on table "public"."payments" to "postgres";

grant DELETE on table "public"."payments" to "postgres";

grant TRUNCATE on table "public"."payments" to "postgres";

grant REFERENCES on table "public"."payments" to "postgres";

grant TRIGGER on table "public"."payments" to "postgres";

grant MAINTAIN on table "public"."payments" to "postgres";

grant INSERT on table "public"."payments" to "anon";

grant SELECT on table "public"."payments" to "anon";

grant UPDATE on table "public"."payments" to "anon";

grant DELETE on table "public"."payments" to "anon";

grant MAINTAIN on table "public"."payments" to "anon";

grant INSERT on table "public"."payments" to "authenticated";

grant SELECT on table "public"."payments" to "authenticated";

grant UPDATE on table "public"."payments" to "authenticated";

grant DELETE on table "public"."payments" to "authenticated";

grant MAINTAIN on table "public"."payments" to "authenticated";

grant INSERT on table "public"."payments" to "service_role";

grant SELECT on table "public"."payments" to "service_role";

grant UPDATE on table "public"."payments" to "service_role";

grant DELETE on table "public"."payments" to "service_role";

grant TRUNCATE on table "public"."payments" to "service_role";

grant REFERENCES on table "public"."payments" to "service_role";

grant TRIGGER on table "public"."payments" to "service_role";

grant MAINTAIN on table "public"."payments" to "service_role";

revoke all on table "public"."properties" from PUBLIC, anon, authenticated, service_role;

grant INSERT on table "public"."properties" to "postgres";

grant SELECT on table "public"."properties" to "postgres";

grant UPDATE on table "public"."properties" to "postgres";

grant DELETE on table "public"."properties" to "postgres";

grant TRUNCATE on table "public"."properties" to "postgres";

grant REFERENCES on table "public"."properties" to "postgres";

grant TRIGGER on table "public"."properties" to "postgres";

grant MAINTAIN on table "public"."properties" to "postgres";

grant INSERT on table "public"."properties" to "anon";

grant SELECT on table "public"."properties" to "anon";

grant UPDATE on table "public"."properties" to "anon";

grant DELETE on table "public"."properties" to "anon";

grant MAINTAIN on table "public"."properties" to "anon";

grant INSERT on table "public"."properties" to "authenticated";

grant SELECT on table "public"."properties" to "authenticated";

grant UPDATE on table "public"."properties" to "authenticated";

grant DELETE on table "public"."properties" to "authenticated";

grant MAINTAIN on table "public"."properties" to "authenticated";

grant INSERT on table "public"."properties" to "service_role";

grant SELECT on table "public"."properties" to "service_role";

grant UPDATE on table "public"."properties" to "service_role";

grant DELETE on table "public"."properties" to "service_role";

grant TRUNCATE on table "public"."properties" to "service_role";

grant REFERENCES on table "public"."properties" to "service_role";

grant TRIGGER on table "public"."properties" to "service_role";

grant MAINTAIN on table "public"."properties" to "service_role";

revoke all on table "public"."quickbooks_connections" from PUBLIC, anon, authenticated, service_role;

grant INSERT on table "public"."quickbooks_connections" to "postgres";

grant SELECT on table "public"."quickbooks_connections" to "postgres";

grant UPDATE on table "public"."quickbooks_connections" to "postgres";

grant DELETE on table "public"."quickbooks_connections" to "postgres";

grant TRUNCATE on table "public"."quickbooks_connections" to "postgres";

grant REFERENCES on table "public"."quickbooks_connections" to "postgres";

grant TRIGGER on table "public"."quickbooks_connections" to "postgres";

grant MAINTAIN on table "public"."quickbooks_connections" to "postgres";

grant INSERT on table "public"."quickbooks_connections" to "service_role";

grant SELECT on table "public"."quickbooks_connections" to "service_role";

grant UPDATE on table "public"."quickbooks_connections" to "service_role";

grant DELETE on table "public"."quickbooks_connections" to "service_role";

grant TRUNCATE on table "public"."quickbooks_connections" to "service_role";

grant REFERENCES on table "public"."quickbooks_connections" to "service_role";

grant TRIGGER on table "public"."quickbooks_connections" to "service_role";

grant MAINTAIN on table "public"."quickbooks_connections" to "service_role";

revoke all on table "public"."quickbooks_oauth_states" from PUBLIC, anon, authenticated, service_role;

grant INSERT on table "public"."quickbooks_oauth_states" to "postgres";

grant SELECT on table "public"."quickbooks_oauth_states" to "postgres";

grant UPDATE on table "public"."quickbooks_oauth_states" to "postgres";

grant DELETE on table "public"."quickbooks_oauth_states" to "postgres";

grant TRUNCATE on table "public"."quickbooks_oauth_states" to "postgres";

grant REFERENCES on table "public"."quickbooks_oauth_states" to "postgres";

grant TRIGGER on table "public"."quickbooks_oauth_states" to "postgres";

grant MAINTAIN on table "public"."quickbooks_oauth_states" to "postgres";

grant INSERT on table "public"."quickbooks_oauth_states" to "service_role";

grant SELECT on table "public"."quickbooks_oauth_states" to "service_role";

grant UPDATE on table "public"."quickbooks_oauth_states" to "service_role";

grant DELETE on table "public"."quickbooks_oauth_states" to "service_role";

grant TRUNCATE on table "public"."quickbooks_oauth_states" to "service_role";

grant REFERENCES on table "public"."quickbooks_oauth_states" to "service_role";

grant TRIGGER on table "public"."quickbooks_oauth_states" to "service_role";

grant MAINTAIN on table "public"."quickbooks_oauth_states" to "service_role";

revoke all on table "public"."quickbooks_transactions" from PUBLIC, anon, authenticated, service_role;

grant INSERT on table "public"."quickbooks_transactions" to "postgres";

grant SELECT on table "public"."quickbooks_transactions" to "postgres";

grant UPDATE on table "public"."quickbooks_transactions" to "postgres";

grant DELETE on table "public"."quickbooks_transactions" to "postgres";

grant TRUNCATE on table "public"."quickbooks_transactions" to "postgres";

grant REFERENCES on table "public"."quickbooks_transactions" to "postgres";

grant TRIGGER on table "public"."quickbooks_transactions" to "postgres";

grant MAINTAIN on table "public"."quickbooks_transactions" to "postgres";

grant INSERT on table "public"."quickbooks_transactions" to "service_role";

grant SELECT on table "public"."quickbooks_transactions" to "service_role";

grant UPDATE on table "public"."quickbooks_transactions" to "service_role";

grant DELETE on table "public"."quickbooks_transactions" to "service_role";

grant TRUNCATE on table "public"."quickbooks_transactions" to "service_role";

grant REFERENCES on table "public"."quickbooks_transactions" to "service_role";

grant TRIGGER on table "public"."quickbooks_transactions" to "service_role";

grant MAINTAIN on table "public"."quickbooks_transactions" to "service_role";

grant SELECT on table "public"."quickbooks_transactions" to "authenticated";

comment on table "public"."quickbooks_transactions" is 'Read-only imported QBO Payments, SalesReceipts and Purchases; separate from local Velnu payment journal to prevent double-counting.';

revoke all on table "public"."reminders" from PUBLIC, anon, authenticated, service_role;

grant INSERT on table "public"."reminders" to "postgres";

grant SELECT on table "public"."reminders" to "postgres";

grant UPDATE on table "public"."reminders" to "postgres";

grant DELETE on table "public"."reminders" to "postgres";

grant TRUNCATE on table "public"."reminders" to "postgres";

grant REFERENCES on table "public"."reminders" to "postgres";

grant TRIGGER on table "public"."reminders" to "postgres";

grant MAINTAIN on table "public"."reminders" to "postgres";

grant INSERT on table "public"."reminders" to "anon";

grant SELECT on table "public"."reminders" to "anon";

grant UPDATE on table "public"."reminders" to "anon";

grant DELETE on table "public"."reminders" to "anon";

grant MAINTAIN on table "public"."reminders" to "anon";

grant INSERT on table "public"."reminders" to "authenticated";

grant SELECT on table "public"."reminders" to "authenticated";

grant UPDATE on table "public"."reminders" to "authenticated";

grant DELETE on table "public"."reminders" to "authenticated";

grant MAINTAIN on table "public"."reminders" to "authenticated";

grant INSERT on table "public"."reminders" to "service_role";

grant SELECT on table "public"."reminders" to "service_role";

grant UPDATE on table "public"."reminders" to "service_role";

grant DELETE on table "public"."reminders" to "service_role";

grant TRUNCATE on table "public"."reminders" to "service_role";

grant REFERENCES on table "public"."reminders" to "service_role";

grant TRIGGER on table "public"."reminders" to "service_role";

grant MAINTAIN on table "public"."reminders" to "service_role";

revoke all on table "public"."user_agreement_acceptances" from PUBLIC, anon, authenticated, service_role;

grant INSERT on table "public"."user_agreement_acceptances" to "postgres";

grant SELECT on table "public"."user_agreement_acceptances" to "postgres";

grant UPDATE on table "public"."user_agreement_acceptances" to "postgres";

grant DELETE on table "public"."user_agreement_acceptances" to "postgres";

grant TRUNCATE on table "public"."user_agreement_acceptances" to "postgres";

grant REFERENCES on table "public"."user_agreement_acceptances" to "postgres";

grant TRIGGER on table "public"."user_agreement_acceptances" to "postgres";

grant MAINTAIN on table "public"."user_agreement_acceptances" to "postgres";

grant INSERT on table "public"."user_agreement_acceptances" to "service_role";

grant SELECT on table "public"."user_agreement_acceptances" to "service_role";

grant UPDATE on table "public"."user_agreement_acceptances" to "service_role";

grant DELETE on table "public"."user_agreement_acceptances" to "service_role";

grant TRUNCATE on table "public"."user_agreement_acceptances" to "service_role";

grant REFERENCES on table "public"."user_agreement_acceptances" to "service_role";

grant TRIGGER on table "public"."user_agreement_acceptances" to "service_role";

grant MAINTAIN on table "public"."user_agreement_acceptances" to "service_role";

grant INSERT on table "public"."user_agreement_acceptances" to "authenticated";

grant SELECT on table "public"."user_agreement_acceptances" to "authenticated";

comment on table "public"."user_agreement_acceptances" is 'Immutable affirmative account terms and AI disclosure acceptance records, retained per version; no client updates or deletes.';

revoke all on table "public"."user_plan_preferences" from PUBLIC, anon, authenticated, service_role;

grant INSERT on table "public"."user_plan_preferences" to "postgres";

grant SELECT on table "public"."user_plan_preferences" to "postgres";

grant UPDATE on table "public"."user_plan_preferences" to "postgres";

grant DELETE on table "public"."user_plan_preferences" to "postgres";

grant TRUNCATE on table "public"."user_plan_preferences" to "postgres";

grant REFERENCES on table "public"."user_plan_preferences" to "postgres";

grant TRIGGER on table "public"."user_plan_preferences" to "postgres";

grant MAINTAIN on table "public"."user_plan_preferences" to "postgres";

grant INSERT on table "public"."user_plan_preferences" to "service_role";

grant SELECT on table "public"."user_plan_preferences" to "service_role";

grant UPDATE on table "public"."user_plan_preferences" to "service_role";

grant DELETE on table "public"."user_plan_preferences" to "service_role";

grant TRUNCATE on table "public"."user_plan_preferences" to "service_role";

grant REFERENCES on table "public"."user_plan_preferences" to "service_role";

grant TRIGGER on table "public"."user_plan_preferences" to "service_role";

grant MAINTAIN on table "public"."user_plan_preferences" to "service_role";

grant INSERT on table "public"."user_plan_preferences" to "authenticated";

grant SELECT on table "public"."user_plan_preferences" to "authenticated";

grant UPDATE on table "public"."user_plan_preferences" to "authenticated";

comment on table "public"."user_plan_preferences" is 'Signup-selected plan preference only. Never treat this as a paid entitlement or subscription state.';

revoke all on table "public"."user_profiles" from PUBLIC, anon, authenticated, service_role;

grant INSERT on table "public"."user_profiles" to "postgres";

grant SELECT on table "public"."user_profiles" to "postgres";

grant UPDATE on table "public"."user_profiles" to "postgres";

grant DELETE on table "public"."user_profiles" to "postgres";

grant TRUNCATE on table "public"."user_profiles" to "postgres";

grant REFERENCES on table "public"."user_profiles" to "postgres";

grant TRIGGER on table "public"."user_profiles" to "postgres";

grant MAINTAIN on table "public"."user_profiles" to "postgres";

grant INSERT on table "public"."user_profiles" to "anon";

grant SELECT on table "public"."user_profiles" to "anon";

grant UPDATE on table "public"."user_profiles" to "anon";

grant DELETE on table "public"."user_profiles" to "anon";

grant MAINTAIN on table "public"."user_profiles" to "anon";

grant INSERT on table "public"."user_profiles" to "authenticated";

grant SELECT on table "public"."user_profiles" to "authenticated";

grant UPDATE on table "public"."user_profiles" to "authenticated";

grant DELETE on table "public"."user_profiles" to "authenticated";

grant MAINTAIN on table "public"."user_profiles" to "authenticated";

grant INSERT on table "public"."user_profiles" to "service_role";

grant SELECT on table "public"."user_profiles" to "service_role";

grant UPDATE on table "public"."user_profiles" to "service_role";

grant DELETE on table "public"."user_profiles" to "service_role";

grant TRUNCATE on table "public"."user_profiles" to "service_role";

grant REFERENCES on table "public"."user_profiles" to "service_role";

grant TRIGGER on table "public"."user_profiles" to "service_role";

grant MAINTAIN on table "public"."user_profiles" to "service_role";

revoke all on table "public"."voice_transcriptions" from PUBLIC, anon, authenticated, service_role;

grant INSERT on table "public"."voice_transcriptions" to "postgres";

grant SELECT on table "public"."voice_transcriptions" to "postgres";

grant UPDATE on table "public"."voice_transcriptions" to "postgres";

grant DELETE on table "public"."voice_transcriptions" to "postgres";

grant TRUNCATE on table "public"."voice_transcriptions" to "postgres";

grant REFERENCES on table "public"."voice_transcriptions" to "postgres";

grant TRIGGER on table "public"."voice_transcriptions" to "postgres";

grant MAINTAIN on table "public"."voice_transcriptions" to "postgres";

grant SELECT on table "public"."voice_transcriptions" to "authenticated";

grant MAINTAIN on table "public"."voice_transcriptions" to "authenticated";

grant INSERT on table "public"."voice_transcriptions" to "service_role";

grant SELECT on table "public"."voice_transcriptions" to "service_role";

grant UPDATE on table "public"."voice_transcriptions" to "service_role";

grant DELETE on table "public"."voice_transcriptions" to "service_role";

grant TRUNCATE on table "public"."voice_transcriptions" to "service_role";

grant REFERENCES on table "public"."voice_transcriptions" to "service_role";

grant TRIGGER on table "public"."voice_transcriptions" to "service_role";

grant MAINTAIN on table "public"."voice_transcriptions" to "service_role";

revoke all on function private.ai_confirmation_guard() from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function private.ai_confirmation_guard() to "postgres";

revoke all on function private.can_write_business(target_business_id uuid) from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function private.can_write_business(target_business_id uuid) to "postgres";

grant EXECUTE on function private.can_write_business(target_business_id uuid) to "authenticated";

grant EXECUTE on function private.can_write_business(target_business_id uuid) to "service_role";

revoke all on function private.commerce_auxiliary_limit() from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function private.commerce_auxiliary_limit() to "postgres";

revoke all on function private.commerce_business_guard() from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function private.commerce_business_guard() to "postgres";

revoke all on function private.commerce_change_item_guard() from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function private.commerce_change_item_guard() to "postgres";

revoke all on function private.commerce_document_guard() from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function private.commerce_document_guard() to "postgres";

revoke all on function private.commerce_identity_guard() from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function private.commerce_identity_guard() to "postgres";

revoke all on function private.commerce_item_guard() from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function private.commerce_item_guard() to "postgres";

revoke all on function private.commerce_number() from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function private.commerce_number() to "postgres";

revoke all on function private.commerce_paid_recalc() from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function private.commerce_paid_recalc() to "postgres";

revoke all on function private.commerce_payment_guard() from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function private.commerce_payment_guard() to "postgres";

revoke all on function private.commerce_quota() from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function private.commerce_quota() to "postgres";

revoke all on function private.commerce_recalc() from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function private.commerce_recalc() to "postgres";

revoke all on function private.execute_confirmed_action(target_action_id uuid) from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function private.execute_confirmed_action(target_action_id uuid) to "postgres";

grant EXECUTE on function private.execute_confirmed_action(target_action_id uuid) to "authenticated";

revoke all on function private.finviant_ai_decision(p_action_id uuid, p_decision text) from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function private.finviant_ai_decision(p_action_id uuid, p_decision text) to "postgres";

grant EXECUTE on function private.finviant_ai_decision(p_action_id uuid, p_decision text) to "authenticated";

revoke all on function private.finviant_execute_ai_mutation(p_action_id uuid) from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function private.finviant_execute_ai_mutation(p_action_id uuid) to "postgres";

grant EXECUTE on function private.finviant_execute_ai_mutation(p_action_id uuid) to "authenticated";

revoke all on function private.finviant_guard_active_appointment() from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function private.finviant_guard_active_appointment() to "postgres";

revoke all on function private.finviant_reserve_ai_attempt(p_business_id uuid, p_kind text) from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function private.finviant_reserve_ai_attempt(p_business_id uuid, p_kind text) to "postgres";

grant EXECUTE on function private.finviant_reserve_ai_attempt(p_business_id uuid, p_kind text) to "authenticated";

revoke all on function private.finviant_sync_job_status() from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function private.finviant_sync_job_status() to "postgres";

revoke all on function private.get_plan_usage(target_business_id uuid) from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function private.get_plan_usage(target_business_id uuid) to "postgres";

grant EXECUTE on function private.get_plan_usage(target_business_id uuid) to "authenticated";

grant EXECUTE on function private.get_plan_usage(target_business_id uuid) to "service_role";

revoke all on function private.has_business_role(target_business_id uuid, allowed_roles text[]) from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function private.has_business_role(target_business_id uuid, allowed_roles text[]) to PUBLIC;

grant EXECUTE on function private.has_business_role(target_business_id uuid, allowed_roles text[]) to "postgres";

grant EXECUTE on function private.has_business_role(target_business_id uuid, allowed_roles text[]) to "authenticated";

grant EXECUTE on function private.has_business_role(target_business_id uuid, allowed_roles text[]) to "service_role";

revoke all on function private.is_business_member(target_business_id uuid) from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function private.is_business_member(target_business_id uuid) to PUBLIC;

grant EXECUTE on function private.is_business_member(target_business_id uuid) to "postgres";

grant EXECUTE on function private.is_business_member(target_business_id uuid) to "authenticated";

grant EXECUTE on function private.is_business_member(target_business_id uuid) to "service_role";

revoke all on function private.is_pro(b uuid) from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function private.is_pro(b uuid) to "postgres";

grant EXECUTE on function private.is_pro(b uuid) to "authenticated";

grant EXECUTE on function private.is_pro(b uuid) to "service_role";

revoke all on function private.set_user_agreement_acceptance_time() from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function private.set_user_agreement_acceptance_time() to PUBLIC;

grant EXECUTE on function private.set_user_agreement_acceptance_time() to "postgres";

revoke all on function private.touch_business_service_interests() from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function private.touch_business_service_interests() to PUBLIC;

grant EXECUTE on function private.touch_business_service_interests() to "postgres";

revoke all on function private.valid_payment_links(links jsonb) from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function private.valid_payment_links(links jsonb) to "postgres";

grant EXECUTE on function private.valid_payment_links(links jsonb) to "authenticated";

grant EXECUTE on function private.valid_payment_links(links jsonb) to "service_role";

revoke all on function private.velnu_financial_role_guard() from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function private.velnu_financial_role_guard() to PUBLIC;

grant EXECUTE on function private.velnu_financial_role_guard() to "postgres";

revoke all on function private.velnu_freeze_document_issuer() from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function private.velnu_freeze_document_issuer() to PUBLIC;

grant EXECUTE on function private.velnu_freeze_document_issuer() to "postgres";

revoke all on function private.velnu_has_accepted_terms() from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function private.velnu_has_accepted_terms() to "postgres";

grant EXECUTE on function private.velnu_has_accepted_terms() to "authenticated";

revoke all on function private.velnu_membership_role_guard() from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function private.velnu_membership_role_guard() to PUBLIC;

grant EXECUTE on function private.velnu_membership_role_guard() to "postgres";

revoke all on function public.assign_change_order_number() from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function public.assign_change_order_number() to "postgres";

grant EXECUTE on function public.assign_change_order_number() to "service_role";

revoke all on function public.assign_estimate_number() from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function public.assign_estimate_number() to "postgres";

grant EXECUTE on function public.assign_estimate_number() to "service_role";

revoke all on function public.assign_invoice_number() from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function public.assign_invoice_number() to "postgres";

grant EXECUTE on function public.assign_invoice_number() to "service_role";

revoke all on function public.bootstrap_business_owner() from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function public.bootstrap_business_owner() to "postgres";

grant EXECUTE on function public.bootstrap_business_owner() to "service_role";

revoke all on function public.claim_document_email(p_request uuid) from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function public.claim_document_email(p_request uuid) to "postgres";

grant EXECUTE on function public.claim_document_email(p_request uuid) to "service_role";

revoke all on function public.consume_document_approval(p_token_hash text, p_action text, p_typed_name text, p_user_agent text, p_terms_agreed boolean) from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function public.consume_document_approval(p_token_hash text, p_action text, p_typed_name text, p_user_agent text, p_terms_agreed boolean) to "postgres";

grant EXECUTE on function public.consume_document_approval(p_token_hash text, p_action text, p_typed_name text, p_user_agent text, p_terms_agreed boolean) to "service_role";

revoke all on function public.convert_estimate_to_invoice(target_estimate_id uuid, target_due_date date) from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function public.convert_estimate_to_invoice(target_estimate_id uuid, target_due_date date) to "postgres";

grant EXECUTE on function public.convert_estimate_to_invoice(target_estimate_id uuid, target_due_date date) to "authenticated";

grant EXECUTE on function public.convert_estimate_to_invoice(target_estimate_id uuid, target_due_date date) to "service_role";

revoke all on function public.create_change_order_document(target_business_id uuid, request_id uuid, payload jsonb) from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function public.create_change_order_document(target_business_id uuid, request_id uuid, payload jsonb) to "postgres";

grant EXECUTE on function public.create_change_order_document(target_business_id uuid, request_id uuid, payload jsonb) to "authenticated";

grant EXECUTE on function public.create_change_order_document(target_business_id uuid, request_id uuid, payload jsonb) to "service_role";

revoke all on function public.create_document(target_business_id uuid, document_kind text, request_id uuid, payload jsonb) from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function public.create_document(target_business_id uuid, document_kind text, request_id uuid, payload jsonb) to "postgres";

grant EXECUTE on function public.create_document(target_business_id uuid, document_kind text, request_id uuid, payload jsonb) to "authenticated";

grant EXECUTE on function public.create_document(target_business_id uuid, document_kind text, request_id uuid, payload jsonb) to "service_role";

revoke all on function public.create_job_atomic(target_business_id uuid, request_id uuid, payload jsonb) from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function public.create_job_atomic(target_business_id uuid, request_id uuid, payload jsonb) to "postgres";

grant EXECUTE on function public.create_job_atomic(target_business_id uuid, request_id uuid, payload jsonb) to "authenticated";

grant EXECUTE on function public.create_job_atomic(target_business_id uuid, request_id uuid, payload jsonb) to "service_role";

revoke all on function public.create_scheduled_job(target_business_id uuid, request_id uuid, payload jsonb) from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function public.create_scheduled_job(target_business_id uuid, request_id uuid, payload jsonb) to "postgres";

grant EXECUTE on function public.create_scheduled_job(target_business_id uuid, request_id uuid, payload jsonb) to "authenticated";

grant EXECUTE on function public.create_scheduled_job(target_business_id uuid, request_id uuid, payload jsonb) to "service_role";

revoke all on function public.decide_ai_action(p_action_id uuid, p_decision text) from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function public.decide_ai_action(p_action_id uuid, p_decision text) to "postgres";

grant EXECUTE on function public.decide_ai_action(p_action_id uuid, p_decision text) to "authenticated";

grant EXECUTE on function public.decide_ai_action(p_action_id uuid, p_decision text) to "service_role";

revoke all on function public.execute_ai_mutation(p_action_id uuid) from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function public.execute_ai_mutation(p_action_id uuid) to "postgres";

grant EXECUTE on function public.execute_ai_mutation(p_action_id uuid) to "authenticated";

grant EXECUTE on function public.execute_ai_mutation(p_action_id uuid) to "service_role";

revoke all on function public.execute_confirmed_action(target_action_id uuid) from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function public.execute_confirmed_action(target_action_id uuid) to "postgres";

grant EXECUTE on function public.execute_confirmed_action(target_action_id uuid) to "authenticated";

grant EXECUTE on function public.execute_confirmed_action(target_action_id uuid) to "service_role";

revoke all on function public.finish_document_email(p_request uuid, p_lease uuid, p_result text, p_provider_id text, p_code text) from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function public.finish_document_email(p_request uuid, p_lease uuid, p_result text, p_provider_id text, p_code text) to "postgres";

grant EXECUTE on function public.finish_document_email(p_request uuid, p_lease uuid, p_result text, p_provider_id text, p_code text) to "service_role";

revoke all on function public.finviant_ops_health() from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function public.finviant_ops_health() to "postgres";

grant EXECUTE on function public.finviant_ops_health() to "service_role";

revoke all on function public.get_dashboard_invoice_totals(target_business_id uuid) from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function public.get_dashboard_invoice_totals(target_business_id uuid) to "postgres";

grant EXECUTE on function public.get_dashboard_invoice_totals(target_business_id uuid) to "authenticated";

grant EXECUTE on function public.get_dashboard_invoice_totals(target_business_id uuid) to "service_role";

revoke all on function public.get_dashboard_metrics(target_business_id uuid) from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function public.get_dashboard_metrics(target_business_id uuid) to "postgres";

grant EXECUTE on function public.get_dashboard_metrics(target_business_id uuid) to "authenticated";

grant EXECUTE on function public.get_dashboard_metrics(target_business_id uuid) to "service_role";

revoke all on function public.get_plan_usage(target_business_id uuid) from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function public.get_plan_usage(target_business_id uuid) to "postgres";

grant EXECUTE on function public.get_plan_usage(target_business_id uuid) to "authenticated";

grant EXECUTE on function public.get_plan_usage(target_business_id uuid) to "service_role";

revoke all on function public.list_due_document_emails() from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function public.list_due_document_emails() to "postgres";

grant EXECUTE on function public.list_due_document_emails() to "service_role";

revoke all on function public.prepare_document_email(p_actor uuid, p_business uuid, p_kind text, p_document uuid, p_request uuid, p_origin text) from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function public.prepare_document_email(p_actor uuid, p_business uuid, p_kind text, p_document uuid, p_request uuid, p_origin text) to "postgres";

grant EXECUTE on function public.prepare_document_email(p_actor uuid, p_business uuid, p_kind text, p_document uuid, p_request uuid, p_origin text) to "service_role";

revoke all on function public.prevent_invoice_overpayment() from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function public.prevent_invoice_overpayment() to "postgres";

grant EXECUTE on function public.prevent_invoice_overpayment() to "service_role";

revoke all on function public.recalc_change_order() from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function public.recalc_change_order() to "postgres";

grant EXECUTE on function public.recalc_change_order() to "service_role";

revoke all on function public.recalc_estimate() from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function public.recalc_estimate() to "postgres";

grant EXECUTE on function public.recalc_estimate() to "service_role";

revoke all on function public.recalc_invoice() from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function public.recalc_invoice() to "postgres";

grant EXECUTE on function public.recalc_invoice() to "service_role";

revoke all on function public.recalc_invoice_payments() from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function public.recalc_invoice_payments() to "postgres";

grant EXECUTE on function public.recalc_invoice_payments() to "service_role";

revoke all on function public.record_delivery_event(p_event_id text, p_provider_id text, p_type text, p_occurred timestamp with time zone) from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function public.record_delivery_event(p_event_id text, p_provider_id text, p_type text, p_occurred timestamp with time zone) to "postgres";

grant EXECUTE on function public.record_delivery_event(p_event_id text, p_provider_id text, p_type text, p_occurred timestamp with time zone) to "service_role";

revoke all on function public.record_manual_payment(target_business_id uuid, invoice_id uuid, request_id uuid, payment_amount numeric, payment_method text, payment_note text) from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function public.record_manual_payment(target_business_id uuid, invoice_id uuid, request_id uuid, payment_amount numeric, payment_method text, payment_note text) to "postgres";

grant EXECUTE on function public.record_manual_payment(target_business_id uuid, invoice_id uuid, request_id uuid, payment_amount numeric, payment_method text, payment_note text) to "authenticated";

grant EXECUTE on function public.record_manual_payment(target_business_id uuid, invoice_id uuid, request_id uuid, payment_amount numeric, payment_method text, payment_note text) to "service_role";

revoke all on function public.record_sandbox_payment_event(p_event_id text, p_account_id text, p_object_id text, p_type text, p_created timestamp with time zone) from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function public.record_sandbox_payment_event(p_event_id text, p_account_id text, p_object_id text, p_type text, p_created timestamp with time zone) to "postgres";

grant EXECUTE on function public.record_sandbox_payment_event(p_event_id text, p_account_id text, p_object_id text, p_type text, p_created timestamp with time zone) to "service_role";

revoke all on function public.record_tagged_delivery_event(p_event_id text, p_provider_id text, p_type text, p_occurred timestamp with time zone, p_request uuid) from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function public.record_tagged_delivery_event(p_event_id text, p_provider_id text, p_type text, p_occurred timestamp with time zone, p_request uuid) to "postgres";

grant EXECUTE on function public.record_tagged_delivery_event(p_event_id text, p_provider_id text, p_type text, p_occurred timestamp with time zone, p_request uuid) to "service_role";

revoke all on function public.reserve_ai_provider_attempt(p_business_id uuid, p_kind text) from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function public.reserve_ai_provider_attempt(p_business_id uuid, p_kind text) to "postgres";

grant EXECUTE on function public.reserve_ai_provider_attempt(p_business_id uuid, p_kind text) to "authenticated";

grant EXECUTE on function public.reserve_ai_provider_attempt(p_business_id uuid, p_kind text) to "service_role";

revoke all on function public.reserve_feature(target_business_id uuid, target_user_id uuid, feature text, request_id uuid) from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function public.reserve_feature(target_business_id uuid, target_user_id uuid, feature text, request_id uuid) to "postgres";

grant EXECUTE on function public.reserve_feature(target_business_id uuid, target_user_id uuid, feature text, request_id uuid) to "service_role";

revoke all on function public.set_change_order_status_timestamps() from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function public.set_change_order_status_timestamps() to "postgres";

grant EXECUTE on function public.set_change_order_status_timestamps() to "service_role";

revoke all on function public.set_job_status_atomic(p_job_id uuid, p_status text) from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function public.set_job_status_atomic(p_job_id uuid, p_status text) to "postgres";

grant EXECUTE on function public.set_job_status_atomic(p_job_id uuid, p_status text) to "authenticated";

grant EXECUTE on function public.set_job_status_atomic(p_job_id uuid, p_status text) to "service_role";

revoke all on function public.set_updated_at() from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function public.set_updated_at() to PUBLIC;

grant EXECUTE on function public.set_updated_at() to "postgres";

grant EXECUTE on function public.set_updated_at() to "anon";

grant EXECUTE on function public.set_updated_at() to "authenticated";

grant EXECUTE on function public.set_updated_at() to "service_role";

revoke all on function public.update_draft_document(target_business_id uuid, document_kind text, document_id uuid, expected_updated_at timestamp with time zone, payload jsonb) from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function public.update_draft_document(target_business_id uuid, document_kind text, document_id uuid, expected_updated_at timestamp with time zone, payload jsonb) to "postgres";

grant EXECUTE on function public.update_draft_document(target_business_id uuid, document_kind text, document_id uuid, expected_updated_at timestamp with time zone, payload jsonb) to "authenticated";

grant EXECUTE on function public.update_draft_document(target_business_id uuid, document_kind text, document_id uuid, expected_updated_at timestamp with time zone, payload jsonb) to "service_role";

revoke all on schema "public" from PUBLIC, anon, authenticated, service_role;

grant USAGE on schema "public" to "pg_database_owner";

grant CREATE on schema "public" to "pg_database_owner";

grant USAGE on schema "public" to PUBLIC;

grant USAGE on schema "public" to "postgres";

grant USAGE on schema "public" to "anon";

grant USAGE on schema "public" to "authenticated";

grant USAGE on schema "public" to "service_role";

revoke all on schema "private" from PUBLIC, anon, authenticated, service_role;

grant USAGE on schema "private" to "postgres";

grant CREATE on schema "private" to "postgres";

grant USAGE on schema "private" to "authenticated";

grant USAGE on schema "private" to "service_role";

-- Future objects require explicit client grants; existing reviewed grants are retained above.

alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;

alter default privileges for role postgres in schema public revoke all on functions from PUBLIC, anon, authenticated;

alter default privileges for role postgres in schema private revoke all on functions from PUBLIC, anon, authenticated;

set check_function_bodies = true;


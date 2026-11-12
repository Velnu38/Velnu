-- Additive export coverage only. Original records, retention and cleanup are unchanged.
-- Existing snapshots keep v1; only new snapshots use v2. Existing RPC grants are retained.
alter table private.owner_archives add column schema_version integer not null default 1 check(schema_version in(1,2));
alter table private.owner_archives alter column schema_version set default 2;

create or replace function private.owner_archive_sources(b uuid,owner_id uuid) returns table(collection text,payload jsonb)
language sql stable security definer set search_path='' as $sources$
select 'private.appointment_reminder_overrides'::text collection,to_jsonb(x) payload from (select t.appointment_id,t.business_id,t.mode,t.lead_hours,t.channel from private.appointment_reminder_overrides t where t.business_id=b) x
union all
select 'private.appointment_reminder_rules'::text collection,to_jsonb(x) payload from (select t.business_id,t.actor_id,t.enabled,t.lead_hours,t.channel from private.appointment_reminder_rules t where t.business_id=b) x
union all
select 'private.appointment_sms_permissions'::text collection,to_jsonb(x) payload from (select t.business_id,t.phone,t.actor_id,t.consented_at from private.appointment_sms_permissions t where t.business_id=b) x
union all
select 'private.business_card_links'::text collection,to_jsonb(x) payload from (select t.business_id,t.actor_id,t.revision,t.card,t.branding,t.created_at,t.expires_at,t.revoked_at from private.business_card_links t where t.business_id=b) x
union all
select 'private.business_cards'::text collection,to_jsonb(x) payload from (select t.business_id,t.revision,t.details,t.updated_at from private.business_cards t where t.business_id=b) x
union all
select 'private.business_entitlements'::text collection,to_jsonb(x) payload from (select t.business_id,t.plan,t.valid_until,t.updated_at from private.business_entitlements t where t.business_id=b) x
union all
select 'private.business_onboarding'::text collection,to_jsonb(x) payload from (select t.business_id,t.channels,t.completed_at from private.business_onboarding t where t.business_id=b) x
union all
select 'private.calendar_event_links'::text collection,to_jsonb(x) payload from (select t.integration_id,t.source_key,t.calendar_id,t.calendar_event_id,t.generation,t.updated_at from private.calendar_event_links t where exists(select 1 from private.calendar_integrations j where j.id=t.integration_id and j.business_id=b)) x
union all
select 'private.calendar_integrations'::text collection,to_jsonb(x) payload from (select t.id,t.business_id,t.user_id,t.provider,t.account_id,t.email,t.calendar_id,t.calendar_name,t.auto_sync,t.state,t.last_synced_at,t.last_error,t.created_at,t.updated_at from private.calendar_integrations t where t.business_id=b) x
union all
select 'private.change_order_billing'::text collection,to_jsonb(x) payload from (select t.change_order_id,t.invoice_id from private.change_order_billing t where exists(select 1 from public.change_orders j where j.id=t.change_order_id and j.business_id=b)) x
union all
select 'private.change_order_line_revisions'::text collection,to_jsonb(x) payload from (select t.change_order_id,t.source_line_id,t.previous,t.revised,t.billed_line,t.approval_sequence from private.change_order_line_revisions t where exists(select 1 from public.change_orders j where j.id=t.change_order_id and j.business_id=b)) x
union all
select 'private.customer_invoice_checkouts'::text collection,to_jsonb(x) payload from (select t.id,t.business_id,t.invoice_id,t.revision_id,t.request_id,t.stripe_account_id,t.livemode,t.amount_minor,t.currency,t.status,t.stripe_session_id,t.stripe_payment_intent,t.payment_id,t.review_reason,t.expires_at,t.created_at from private.customer_invoice_checkouts t where t.business_id=b) x
union all
select 'private.customer_invoice_refunds'::text collection,to_jsonb(x) payload from (select t.stripe_account_id,t.refund_id,t.checkout_id,t.amount_minor,t.refunded_at from private.customer_invoice_refunds t where exists(select 1 from private.customer_invoice_checkouts j where j.id=t.checkout_id and j.business_id=b)) x
union all
select 'private.customer_payment_merchants'::text collection,to_jsonb(x) payload from (select t.business_id,t.stripe_account_id,t.livemode,t.enabled,t.verified_at,t.verification_reference from private.customer_payment_merchants t where t.business_id=b) x
union all
select 'private.delivery_preferences'::text collection,to_jsonb(x) payload from (select t.business_id,t.user_id,t.email,t.phone,t.email_ready,t.sms_ready,t.acknowledged_at from private.delivery_preferences t where t.business_id=b) x
union all
select 'private.document_versions'::text collection,to_jsonb(x) payload from (select t.id,t.business_id,t.kind,t.document_id,t.revision_number,t.snapshot,t.snapshot_hash,t.created_at,t.superseded_at,t.action_expires_at,t.pdf_bucket,t.pdf_path,t.pdf_sha256,t.pdf_byte_size,t.pdf_created_at from private.document_versions t where t.business_id=b) x
union all
select 'private.expense_invoice_drafts'::text collection,to_jsonb(x) payload from (select t.expense_id,t.business_id,t.invoice_id,t.created_at from private.expense_invoice_drafts t where t.business_id=b) x
union all
select 'private.field_time_submissions'::text collection,to_jsonb(x) payload from (select t.id,t.business_id,t.job_id,t.visit_id,t.worker_id,t.submitted_by,t.worked_on,t.minutes,t.note,t.status,t.approved_rate,t.version,t.reviewed_by,t.review_note,t.created_at from private.field_time_submissions t where t.business_id=b) x
union all
select 'private.fin_reviews'::text collection,to_jsonb(x) payload from (select t.id,t.thread_id,t.business_id,t.user_id,t.version,t.steps,t.status,t.expires_at,t.result,t.created_at,t.executed_at from private.fin_reviews t where t.business_id=b and t.user_id=owner_id) x
union all
select 'private.fin_threads'::text collection,to_jsonb(x) payload from (select t.id,t.business_id,t.user_id,t.revision,t.last_request,t.request_text,t.history,t.scope,t.response,t.updated_at from private.fin_threads t where t.business_id=b and t.user_id=owner_id) x
union all
select 'private.invoice_reminder_preferences'::text collection,to_jsonb(x) payload from (select t.business_id,t.invoice_id,t.mode,t.after_days,t.repeat_days,t.max_reminders,t.updated_at from private.invoice_reminder_preferences t where t.business_id=b) x
union all
select 'private.job_activity'::text collection,to_jsonb(x) payload from (select t.id,t.business_id,t.job_id,t.actor_id,t.event,t.created_at from private.job_activity t where t.business_id=b) x
union all
select 'private.job_budgets'::text collection,to_jsonb(x) payload from (select t.business_id,t.job_id,t.revenue,t.cost,t.hours,t.version,t.updated_at from private.job_budgets t where t.business_id=b) x
union all
select 'private.job_completion_reports'::text collection,to_jsonb(x) payload from (select t.id,t.business_id,t.job_id,t.version,t.snapshot,t.created_by,t.created_at from private.job_completion_reports t where t.business_id=b) x
union all
select 'private.job_cost_exclusions'::text collection,to_jsonb(x) payload from (select t.business_id,t.job_id,t.expense_id,t.reason,t.created_by,t.created_at from private.job_cost_exclusions t where t.business_id=b) x
union all
select 'private.job_materials'::text collection,to_jsonb(x) payload from (select t.id,t.business_id,t.job_id,t.name,t.quantity,t.unit,t.supplier,t.status,t.estimated_cost,t.version,t.created_at,t.updated_at from private.job_materials t where t.business_id=b) x
union all
select 'private.job_report_photos'::text collection,to_jsonb(x) payload from (select t.report_id,t.photo_id,t.storage_path from private.job_report_photos t where exists(select 1 from private.job_completion_reports j where j.id=t.report_id and j.business_id=b)) x
union all
select 'private.job_task_templates'::text collection,to_jsonb(x) payload from (select t.id,t.business_id,t.name,t.items,t.created_at from private.job_task_templates t where t.business_id=b) x
union all
select 'private.job_tasks'::text collection,to_jsonb(x) payload from (select t.id,t.business_id,t.job_id,t.title,t.completed,t.due_on,t.worker_id,t.version,t.created_at,t.updated_at,t.priority,t.visit_id from private.job_tasks t where t.business_id=b) x
union all
select 'private.job_template_applications'::text collection,to_jsonb(x) payload from (select t.business_id,t.job_id,t.request_id,t.template_id from private.job_template_applications t where t.business_id=b) x
union all
select 'private.job_time_entries'::text collection,to_jsonb(x) payload from (select t.id,t.business_id,t.job_id,t.worker_id,t.worked_on,t.minutes,t.hourly_cost,t.note,t.created_by,t.request_id,t.created_at,t.version from private.job_time_entries t where t.business_id=b) x
union all
select 'private.managed_delivery_accounts'::text collection,to_jsonb(x) payload from (select t.business_id,t.email_active,t.sms_active,t.sms_from,t.reply_to,t.sms_reply_route,t.activated_at from private.managed_delivery_accounts t where t.business_id=b) x
union all
select 'private.monthly_usage'::text collection,to_jsonb(x) payload from (select t.business_id,t.month,t.documents,t.ai,t.voice,t.email,t.invoice_estimate_documents from private.monthly_usage t where t.business_id=b) x
union all
select 'private.processing_fee_preferences'::text collection,to_jsonb(x) payload from (select t.business_id,t.requested,t.rate_basis_points,t.updated_at from private.processing_fee_preferences t where t.business_id=b) x
union all
select 'private.recurring_invoice_occurrences'::text collection,to_jsonb(x) payload from (select t.id,t.plan_id,t.business_id,t.bill_date,t.invoice_id,t.job_id,t.schedule_error,t.created_at from private.recurring_invoice_occurrences t where t.business_id=b) x
union all
select 'private.recurring_invoice_plans'::text collection,to_jsonb(x) payload from (select t.id,t.business_id,t.source_invoice_id,t.created_by,t.customer_id,t.property_id,t.template,t.title,t.cadence,t.anchor_date,t.next_index,t.next_date,t.end_date,t.due_days,t.timezone,t.schedule_visit,t.visit_time,t.duration_minutes,t.workers,t.status,t.last_error,t.created_at from private.recurring_invoice_plans t where t.business_id=b) x
union all
select 'private.reminder_rules'::text collection,to_jsonb(x) payload from (select t.business_id,t.actor_id,t.enabled,t.after_days,t.repeat_days,t.max_reminders,t.updated_at from private.reminder_rules t where t.business_id=b) x
union all
select 'private.scheduling_offer_slots'::text collection,to_jsonb(x) payload from (select t.id,t.offer_id,t.starts_at,t.ends_at from private.scheduling_offer_slots t where exists(select 1 from private.scheduling_offers j where j.id=t.offer_id and j.business_id=b)) x
union all
select 'private.scheduling_offers'::text collection,to_jsonb(x) payload from (select t.id,t.business_id,t.estimate_id,t.property_id,t.title,t.assigned_user_ids,t.status,t.approved_by,t.approved_at,t.expires_at,t.customer_note,t.recipient_email,t.job_id,t.selected_slot_id,t.customer_name,t.booked_at,t.public_snapshot,t.confirmed_snapshot from private.scheduling_offers t where t.business_id=b) x
union all
select 'private.scheduling_preferences'::text collection,to_jsonb(x) payload from (select t.business_id,t.work_days,t.start_minutes,t.end_minutes,t.duration_minutes,t.buffer_minutes,t.notice_hours,t.updated_at from private.scheduling_preferences t where t.business_id=b) x
union all
select 'private.sms_permissions'::text collection,to_jsonb(x) payload from (select t.business_id,t.phone,t.actor_id,t.consented_at from private.sms_permissions t where t.business_id=b) x
union all
select 'private.square_connections'::text collection,to_jsonb(x) payload from (select t.business_id,t.merchant_id,t.location_id,t.location_name,t.currency,t.environment,t.token_expires_at,t.token_version,t.enabled,t.connected_at from private.square_connections t where t.business_id=b) x
union all
select 'private.square_invoice_operations'::text collection,to_jsonb(x) payload from (select t.id,t.business_id,t.invoice_id,t.request_id,t.created_by,t.kind,t.environment,t.merchant_id,t.location_id,t.amount_minor,t.currency,t.invoice_total,t.revision_id,t.order_id,t.link_id,t.provider_payment_id,t.payment_id,t.status,t.review_reason,t.created_at from private.square_invoice_operations t where t.business_id=b) x
union all
select 'private.square_payment_refunds'::text collection,to_jsonb(x) payload from (select t.merchant_id,t.environment,t.refund_id,t.operation_id,t.amount_minor,t.refunded_at from private.square_payment_refunds t where exists(select 1 from private.square_invoice_operations j where j.id=t.operation_id and j.business_id=b)) x
union all
select 'private.square_processing_costs'::text collection,to_jsonb(x) payload from (select t.operation_id,t.amount_minor,t.entry_id from private.square_processing_costs t where exists(select 1 from private.square_invoice_operations j where j.id=t.operation_id and j.business_id=b)) x
union all
select 'private.support_cases'::text collection,to_jsonb(x) payload from (select t.id,t.business_id,t.reporter_id,t.title,t.description,t.priority,t.status,t.version,t.created_at,t.updated_at from private.support_cases t where t.business_id=b) x
union all
select 'private.support_messages'::text collection,to_jsonb(x) payload from (select t.id,t.case_id,t.audience,t.body,t.created_at from private.support_messages t where t.audience='customer' and exists(select 1 from private.support_cases j where j.id=t.case_id and j.business_id=b)) x
union all
select 'private.team_audit'::text collection,to_jsonb(x) payload from (select t.id,t.business_id,t.actor_id,t.action,t.target_id,t.created_at from private.team_audit t where t.business_id=b) x
union all
select 'private.team_invitations'::text collection,to_jsonb(x) payload from (select t.id,t.business_id,t.email,t.role,t.access_modules,t.created_by,t.created_at,t.expires_at,t.accepted_at,t.revoked_at,t.accepted_by from private.team_invitations t where t.business_id=b) x
union all
select 'private.tier_usage'::text collection,to_jsonb(x) payload from (select t.business_id,t.period,t.feature,t.used from private.tier_usage t where t.business_id=b) x
union all
select 'private.worker_profiles'::text collection,to_jsonb(x) payload from (select t.business_id,t.id,t.name,t.trade,t.active,t.is_owner,t.use_business_hours,t.work_days,t.start_minutes,t.end_minutes,t.updated_at from private.worker_profiles t where t.business_id=b) x
union all
select 'private.worker_time_off'::text collection,to_jsonb(x) payload from (select t.id,t.business_id,t.user_id,t.starts_at,t.ends_at,t.note from private.worker_time_off t where t.business_id=b) x
union all
select 'public.ai_actions'::text collection,to_jsonb(x) payload from (select t.id,t.business_id,t.user_id,t.source,t.raw_input,t.intent,t.parsed_payload,t.status,t.requires_confirmation,t.error_message,t.created_at,t.confirmed_at,t.executed_at from public.ai_actions t where t.business_id=b and t.user_id=owner_id) x
union all
select 'public.appointments'::text collection,to_jsonb(x) payload from (select t.id,t.business_id,t.job_id,t.customer_id,t.assigned_user_id,t.title,t.starts_at,t.ends_at,t.status,t.notes,t.created_at,t.updated_at,t.visit_worker_ids,t.visit_version from public.appointments t where t.business_id=b) x
union all
select 'public.bookkeeping_entries'::text collection,to_jsonb(x) payload from (select t.id,t.business_id,t.created_by,t.entry_date,t.direction,t.amount,t.currency,t.category,t.description,t.notes,t.created_at,t.job_id,t.estimate_id,t.invoice_id,t.source_kind from public.bookkeeping_entries t where t.business_id=b) x
union all
select 'public.business_branding'::text collection,to_jsonb(x) payload from (select t.business_id,t.logo_data_url,t.updated_at from public.business_branding t where t.business_id=b) x
union all
select 'public.business_members'::text collection,to_jsonb(x) payload from (select t.business_id,t.user_id,t.role,t.created_at,t.access_modules from public.business_members t where t.business_id=b) x
union all
select 'public.business_service_interests'::text collection,to_jsonb(x) payload from (select t.business_id,t.selected_services,t.preferred_plan,t.updated_by,t.updated_at from public.business_service_interests t where t.business_id=b) x
union all
select 'public.business_settings'::text collection,to_jsonb(x) payload from (select t.business_id,t.payment_links,t.payment_instructions,t.updated_at,t.default_tax_rate,t.pricing_adjustment_percent,t.payment_service_setups from public.business_settings t where t.business_id=b) x
union all
select 'public.businesses'::text collection,to_jsonb(x) payload from (select t.id,t.name,t.legal_name,t.email,t.phone,t.website,t.address_line1,t.address_line2,t.city,t.state,t.postal_code,t.country,t.timezone,t.currency,t.invoice_prefix,t.next_invoice_number,t.estimate_prefix,t.next_estimate_number,t.created_at,t.updated_at,t.created_by_user_id,t.change_order_prefix,t.next_change_order_number,t.logo_path,t.business_description,t.services_offered,t.service_area,t.team_size,t.team_roles,t.document_accent,t.document_footer,t.profile_completed_at,t.google_review_url from public.businesses t where t.id=b) x
union all
select 'public.change_order_items'::text collection,to_jsonb(x) payload from (select t.id,t.change_order_id,t.business_id,t.description,t.quantity,t.unit_price,t.tax_rate,t.line_total,t.sort_order,t.created_at from public.change_order_items t where t.business_id=b) x
union all
select 'public.change_orders'::text collection,to_jsonb(x) payload from (select t.id,t.business_id,t.customer_id,t.job_id,t.estimate_id,t.change_order_number,t.status,t.title,t.description,t.reason,t.schedule_impact_days,t.schedule_note,t.issue_date,t.subtotal,t.tax_amount,t.total,t.notes,t.customer_message,t.sent_at,t.approved_at,t.declined_at,t.created_at,t.updated_at,t.request_id,t.issuer_snapshot,t.source_invoice_id,t.change_totals from public.change_orders t where t.business_id=b) x
union all
select 'public.customers'::text collection,to_jsonb(x) payload from (select t.id,t.business_id,t.first_name,t.last_name,t.company,t.email,t.phone,t.preferred_contact,t.notes,t.archived,t.created_at,t.updated_at from public.customers t where t.business_id=b) x
union all
select 'public.document_approval_links'::text collection,to_jsonb(x) payload from (select t.id,t.business_id,t.document_type,t.estimate_id,t.change_order_id,t.expires_at,t.revoked_at,t.created_by_user_id,t.created_at,t.document_version_id,t.legacy_pdf_version_id,t.legacy_entitlement from public.document_approval_links t where t.business_id=b) x
union all
select 'public.document_approvals'::text collection,to_jsonb(x) payload from (select t.id,t.approval_link_id,t.business_id,t.document_type,t.estimate_id,t.change_order_id,t.action,t.typed_name,t.amount_at_action,t.document_snapshot,t.user_agent,t.created_at from public.document_approvals t where t.business_id=b) x
union all
select 'public.document_schedules'::text collection,to_jsonb(x) payload from (select t.id,t.business_id,t.estimate_id,t.invoice_id,t.job_title,t.description,t.scheduled_start_time,t.scheduled_end_time,t.timezone,t.status,t.updated_at from public.document_schedules t where t.business_id=b) x
union all
select 'public.estimate_items'::text collection,to_jsonb(x) payload from (select t.id,t.estimate_id,t.business_id,t.description,t.quantity,t.unit_price,t.tax_rate,t.line_total,t.sort_order,t.created_at from public.estimate_items t where t.business_id=b) x
union all
select 'public.estimates'::text collection,to_jsonb(x) payload from (select t.id,t.business_id,t.customer_id,t.job_id,t.estimate_number,t.status,t.issue_date,t.expires_on,t.subtotal,t.tax_amount,t.total,t.notes,t.customer_message,t.created_at,t.updated_at,t.request_id,t.issuer_snapshot,t.property_id,t.payment_links,t.payment_instructions,t.customer_reference from public.estimates t where t.business_id=b) x
union all
select 'public.invoice_items'::text collection,to_jsonb(x) payload from (select t.id,t.invoice_id,t.business_id,t.description,t.quantity,t.unit_price,t.tax_rate,t.line_total,t.sort_order,t.created_at,t.source_estimate_line_id,t.source_change_order_id from public.invoice_items t where t.business_id=b) x
union all
select 'public.invoices'::text collection,to_jsonb(x) payload from (select t.id,t.business_id,t.customer_id,t.job_id,t.estimate_id,t.invoice_number,t.status,t.issue_date,t.due_date,t.subtotal,t.tax_amount,t.total,t.amount_paid,t.balance_due,t.notes,t.customer_message,t.sent_at,t.paid_at,t.created_at,t.updated_at,t.payment_links,t.payment_instructions,t.request_id,t.issuer_snapshot,t.work_completed,t.work_completed_at,t.deposit_estimate_id,t.deposit_source_invoice_id,t.deposit_credit,t.property_id,t.customer_reference from public.invoices t where t.business_id=b) x
union all
select 'public.jobs'::text collection,to_jsonb(x) payload from (select t.id,t.business_id,t.customer_id,t.property_id,t.title,t.description,t.status,t.scheduled_start,t.scheduled_end,t.completed_at,t.internal_notes,t.created_at,t.updated_at,t.request_id,t.assigned_user_ids,t.source_estimate_id from public.jobs t where t.business_id=b) x
union all
select 'public.messages'::text collection,to_jsonb(x) payload from (select t.id,t.business_id,t.customer_id,t.invoice_id,t.estimate_id,t.direction,t.channel,t.recipient,t.subject,t.body,t.provider,t.provider_message_id,t.status,t.sent_at,t.created_at,t.change_order_id,t.email_payload_hash from public.messages t where t.business_id=b) x
union all
select 'public.payments'::text collection,to_jsonb(x) payload from (select t.id,t.business_id,t.invoice_id,t.amount,t.method,t.provider,t.provider_payment_id,t.status,t.paid_at,t.notes,t.created_at,t.request_id from public.payments t where t.business_id=b) x
union all
select 'public.properties'::text collection,to_jsonb(x) payload from (select t.id,t.business_id,t.customer_id,t.label,t.address_line1,t.address_line2,t.city,t.state,t.postal_code,t.access_notes,t.created_at,t.updated_at from public.properties t where t.business_id=b) x
union all
select 'public.quickbooks_connections'::text collection,to_jsonb(x) payload from (select t.business_id,t.realm_id,t.environment,t.access_expires_at,t.connected_by,t.connected_at,t.updated_at,t.last_sync_at,t.last_sync_count from public.quickbooks_connections t where t.business_id=b) x
union all
select 'public.quickbooks_transactions'::text collection,to_jsonb(x) payload from (select t.id,t.business_id,t.realm_id,t.source_type,t.source_id,t.direction,t.txn_date,t.amount,t.currency,t.description,t.source_updated_at,t.last_seen_at from public.quickbooks_transactions t where t.business_id=b) x
union all
select 'public.record_photos'::text collection,to_jsonb(x) payload from (select t.id,t.business_id,t.job_id,t.estimate_id,t.invoice_id,t.file_name,t.byte_size,t.media_type,t.created_by,t.created_at,t.storage_path,t.expense_id from public.record_photos t where t.business_id=b) x
union all
select 'public.reminders'::text collection,to_jsonb(x) payload from (select t.id,t.business_id,t.customer_id,t.invoice_id,t.estimate_id,t.job_id,t.kind,t.due_at,t.status,t.note,t.created_at,t.completed_at from public.reminders t where t.business_id=b) x
union all
select 'public.service_items'::text collection,to_jsonb(x) payload from (select t.id,t.business_id,t.description,t.unit_price,t.tax_rate,t.active,t.created_at from public.service_items t where t.business_id=b) x
union all
select 'public.service_packages'::text collection,to_jsonb(x) payload from (select t.id,t.business_id,t.name,t.items,t.active,t.created_at from public.service_packages t where t.business_id=b) x
union all
select 'public.user_agreement_acceptances'::text collection,to_jsonb(x) payload from (select t.id,t.user_id,t.agreement_version,t.terms_accepted,t.ai_disclosure_acknowledged,t.electronic_records_consent,t.acceptance_method,t.accepted_at,t.selected_tier_at_acceptance from public.user_agreement_acceptances t where t.user_id=owner_id) x
union all
select 'public.user_plan_preferences'::text collection,to_jsonb(x) payload from (select t.user_id,t.selected_tier,t.selected_at from public.user_plan_preferences t where t.user_id=owner_id) x
union all
select 'public.user_profiles'::text collection,to_jsonb(x) payload from (select t.user_id,t.full_name,t.phone,t.created_at,t.updated_at from public.user_profiles t where t.user_id=owner_id) x
union all
select 'public.voice_transcriptions'::text collection,to_jsonb(x) payload from (select t.id,t.business_id,t.user_id,t.provider,t.model,t.transcript,t.duration_seconds,t.confidence,t.created_at from public.voice_transcriptions t where t.business_id=b and t.user_id=owner_id) x
union all
select 'private.delivery_tasks'::text collection,to_jsonb(x) payload from (select t.id,t.business_id,t.actor_id,t.kind,t.document_id,t.due_at,t.reminder,t.status,t.last_error,t.created_at from private.delivery_tasks t where t.business_id=b) x
union all
select 'private.finviant_email_outbox'::text collection,to_jsonb(x) payload from (select t.id,t.business_id,t.actor_id,t.document_kind,t.document_id,t.status,t.attempts,t.provider_id,t.created_at,t.next_attempt_at,t.last_code,t.last_event_at,t.document_version_id,t.pdf_sha256,t.pdf_frozen_at,t.payload->'to' as recipient from private.finviant_email_outbox t where t.business_id=b) x
union all
select 'private.finviant_delivery_events'::text collection,to_jsonb(x) payload from (select t.event_id,t.provider_id,t.event_type,t.occurred_at,t.received_at from private.finviant_delivery_events t where exists(select 1 from private.finviant_email_outbox o where o.business_id=b and o.provider_id=t.provider_id) or exists(select 1 from private.appointment_reminder_queue q where q.business_id=b and q.channel='email' and q.provider_id=t.provider_id)) x
union all
select 'private.managed_sms'::text collection,to_jsonb(x) payload from (select t.id,t.business_id,t.actor_id,t.kind,t.document_id,t.phone,t.sender,t.segments,t.status,t.provider_id,t.created_at,t.updated_at from private.managed_sms t where t.business_id=b) x
union all
select 'private.business_card_sms'::text collection,to_jsonb(x) payload from (select t.id,t.business_id,t.actor_id,t.revision,t.phone,t.sender,t.segments,t.status,t.provider_id,t.customer_id,t.created_at,t.updated_at from private.business_card_sms t where t.business_id=b) x
union all
select 'private.appointment_reminder_queue'::text collection,to_jsonb(x) payload from (select t.id,t.business_id,t.appointment_id,t.occurrence_id,t.starts_at,t.due_at,t.channel,t.status,t.provider_id,t.last_error,t.created_at,t.updated_at,t.snapshot->>'actor_id' as actor_id,t.snapshot->>'customer_id' as customer_id,t.snapshot->>'recipient' as recipient from private.appointment_reminder_queue t where t.business_id=b) x
union all
select 'private.job_invoice_results'::text collection,to_jsonb(x) payload from (select t.job_id,t.business_id,t.invoice_id,t.error_code,t.updated_at from private.job_invoice_results t where t.business_id=b) x
union all
select 'storage_files',jsonb_build_object('bucket',o.bucket_id,'path',o.name,'byte_size',(o.metadata->>'size')::bigint,'updated_at',o.updated_at,'etag',o.metadata->>'eTag','sha256',(select d.pdf_sha256 from private.document_versions d where d.business_id=b and d.pdf_bucket=o.bucket_id and d.pdf_path=o.name limit 1))
 from storage.objects o where o.bucket_id in('finviant-record-photos','velnu-business-logos','finviant-document-pdfs') and left(o.name,37)=b::text||'/'
$sources$;
revoke all on function private.owner_archive_sources(uuid,uuid) from public,anon,authenticated,service_role;
create or replace function public.begin_owner_archive(p_business uuid,p_request uuid) returns uuid
language plpgsql security definer set search_path='' set statement_timeout='90s' as $$
declare existing private.owner_archives%rowtype;v_counts jsonb;records bigint;files bigint;bytes bigint;
begin
 if auth.uid() is null or not private.is_primary_owner(p_business) then raise exception 'Primary owner access is required.' using errcode='42501';end if;
 if p_request is null then raise exception 'An archive request is required.' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('owner-archive:'||p_business::text,0));
 select * into existing from private.owner_archives where id=p_request;
 if found then
  if existing.business_id<>p_business or existing.owner_id<>auth.uid() then raise exception 'Archive unavailable.' using errcode='42501';end if;
  return existing.id;
 end if;
 if (select count(*) from private.owner_archives where business_id=p_business and created_at>now()-interval '1 day')>=2 then raise exception 'Two archives were requested in the last day. Resume an existing archive or try tomorrow.' using errcode='54000';end if;
 if exists(select 1 from public.record_photos p where p.business_id=p_business and not exists(select 1 from storage.objects o where o.bucket_id='finviant-record-photos' and o.name=p.storage_path))
 or exists(select 1 from private.document_versions d where d.business_id=p_business and d.pdf_path is not null and not exists(select 1 from storage.objects o where o.bucket_id='finviant-document-pdfs' and o.name=d.pdf_path)) then
  raise exception 'An attachment is missing or still uploading. Resolve it before making a complete archive.' using errcode='55000';end if;
 if exists(select 1 from public.businesses t where t.id=p_business and nullif(t.logo_path,'') is not null and not exists(select 1 from storage.objects o where o.bucket_id='velnu-business-logos' and o.name=t.logo_path and left(o.name,37)=p_business::text||'/'))
 or exists(select 1 from private.job_report_photos t join private.job_completion_reports r on r.id=t.report_id where r.business_id=p_business and not exists(select 1 from storage.objects o where o.bucket_id='finviant-record-photos' and o.name=t.storage_path and left(o.name,37)=p_business::text||'/')) then
  raise exception 'A logo or completion-report attachment is missing. Resolve it before making a complete archive.' using errcode='55000';end if;
 insert into private.owner_archives(id,business_id,owner_id) values(p_request,p_business,auth.uid());
 insert into private.owner_archive_rows(archive_id,seq,collection,payload)
 select p_request,row_number() over(order by collection,payload::text),collection,payload from private.owner_archive_sources(p_business,auth.uid());
 if exists(select 1 from private.owner_archive_rows r where r.archive_id=p_request and ((r.collection='public.record_photos' and not exists(select 1 from private.owner_archive_rows f where f.archive_id=p_request and f.collection='storage_files' and f.payload->>'bucket'='finviant-record-photos' and f.payload->>'path'=r.payload->>'storage_path')) or (r.collection='private.document_versions' and r.payload->>'pdf_path' is not null and not exists(select 1 from private.owner_archive_rows f where f.archive_id=p_request and f.collection='storage_files' and f.payload->>'bucket'='finviant-document-pdfs' and f.payload->>'path'=r.payload->>'pdf_path')))) then
  raise exception 'Stored files changed during the archive request. Retry after uploads finish.' using errcode='55000';end if;
 if exists(select 1 from private.owner_archive_rows r where r.archive_id=p_request and
 ((r.collection='public.businesses' and nullif(r.payload->>'logo_path','') is not null and not exists(select 1 from private.owner_archive_rows f where f.archive_id=p_request and f.collection='storage_files' and f.payload->>'bucket'='velnu-business-logos' and f.payload->>'path'=r.payload->>'logo_path'))
 or (r.collection='private.job_report_photos' and not exists(select 1 from private.owner_archive_rows f where f.archive_id=p_request and f.collection='storage_files' and f.payload->>'bucket'='finviant-record-photos' and f.payload->>'path'=r.payload->>'storage_path')))) then
  raise exception 'Stored files changed during the archive request. Retry after uploads finish.' using errcode='55000';end if;
 select coalesce(jsonb_object_agg(collection,n),'{}'::jsonb) into v_counts from (select collection,count(*) n from private.owner_archive_rows where archive_id=p_request group by collection)x;
 select count(*) filter(where collection<>'storage_files'),count(*) filter(where collection='storage_files'),coalesce(sum(octet_length(payload::text)),0)
 into records,files,bytes from private.owner_archive_rows where archive_id=p_request;
 if bytes>250000000 or exists(select 1 from private.owner_archive_rows where archive_id=p_request and octet_length(payload::text)>10000000) then raise exception 'This archive requires a larger export allocation. No partial archive was created.' using errcode='54000';end if;
 update private.owner_archives set record_count=records,file_count=files,source_bytes=bytes,counts=v_counts where id=p_request;
 -- Record parts stay under 14 MB even when a single record crosses the 4 MB boundary.
 with sizes as(select seq,sum(octet_length(payload::text)+128) over(order by seq) running from private.owner_archive_rows where archive_id=p_request and collection<>'storage_files'),
 groups as(select min(seq) first_seq,max(seq) last_seq from sizes group by floor((running-1)/4000000))
 insert into private.owner_archive_parts(archive_id,part_no,kind,first_seq,last_seq)
 select p_request,row_number() over(order by first_seq)::integer,'records',first_seq,last_seq from groups;
 with sizes as(select seq,row_number() over(order by seq) n,sum(greatest(coalesce((payload->>'byte_size')::bigint,0),1)) over(order by seq) running from private.owner_archive_rows where archive_id=p_request and collection='storage_files'),
 groups as(select min(seq) first_seq,max(seq) last_seq from sizes group by floor((running-1)/8000000),floor((n-1)/20))
 insert into private.owner_archive_parts(archive_id,part_no,kind,first_seq,last_seq)
 select p_request,(select count(*) from private.owner_archive_parts where archive_id=p_request)+row_number() over(order by first_seq),'file',first_seq,last_seq from groups;
 return p_request;
end $$;

create or replace function public.claim_owner_archive_part(p_business uuid,p_archive uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a private.owner_archives%rowtype;p private.owner_archive_parts%rowtype;token uuid:=gen_random_uuid();data jsonb;
begin
 if auth.uid() is null or not private.is_primary_owner(p_business) then raise exception 'Primary owner access is required.' using errcode='42501';end if;
 select * into a from private.owner_archives where id=p_archive and business_id=p_business and owner_id=auth.uid() for update;
 if not found or a.expires_at<=now() then raise exception 'Archive unavailable or expired.' using errcode='42501';end if;
 if a.status='ready' then return jsonb_build_object('ready',true);end if;
 if exists(select 1 from private.owner_archive_parts where archive_id=a.id and state='pending' and lease_until>now()) then return jsonb_build_object('busy',true);end if;
 select * into p from private.owner_archive_parts where archive_id=a.id and state='pending' order by part_no limit 1 for update;
 if not found then update private.owner_archives set status='ready' where id=a.id;return jsonb_build_object('ready',true);end if;
 update private.owner_archive_parts set lease=token,lease_until=now()+interval '2 minutes' where archive_id=a.id and part_no=p.part_no;
 select jsonb_agg(jsonb_build_object('collection',collection,'data',payload) order by seq) into data from private.owner_archive_rows where archive_id=a.id and seq between p.first_seq and p.last_seq and (p.kind='file' or collection<>'storage_files');
 return jsonb_build_object('schema_version',a.schema_version,'archive_id',a.id,'business_id',a.business_id,'part_no',p.part_no,'kind',p.kind,'lease',token,'created_at',a.created_at,'expires_at',a.expires_at,'counts',a.counts,'part_count',(select count(*) from private.owner_archive_parts where archive_id=a.id),'rows',data);
end $$;


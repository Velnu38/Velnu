-- Protected operational aggregates. No contacts, tokens, message contents or
-- provider payloads are returned; the existing service-only ACL is retained.
create or replace function public.finviant_ops_health() returns jsonb
language sql security definer set search_path='' as $$
 select jsonb_build_object('database','reachable','checked_at',now(),
 'email_queued',(select count(*) from private.finviant_email_outbox where status='queued'),
 'email_uncertain',(select count(*) from private.finviant_email_outbox where status in('uncertain','reconciliation_required')),
 'email_stale',(select count(*) from private.finviant_email_outbox where status in('queued','sending','uncertain') and created_at<now()-interval '30 minutes'),
 'sandbox_events_awaiting_reconciliation',(select count(*) from private.finviant_payment_events where state='awaiting_reconciliation'),
 'failed_email_last_day',(select count(*) from private.finviant_email_outbox where status='failed' and created_at>now()-interval '1 day'),
 'calendar_queued',(select count(*) from private.calendar_sync_queue where not dead),
 'calendar_stale',(select count(*) from private.calendar_sync_queue where not dead and available_at<now()-interval '30 minutes'),
 'calendar_dead',(select count(*) from private.calendar_sync_queue where dead),
 'calendar_reconnect_required',(select count(*) from private.calendar_integrations where auto_sync and state='reconnect_required'),
 'appointment_queued',(select count(*) from private.appointment_reminder_queue where status='queued'),
 'appointment_stale',(select count(*) from private.appointment_reminder_queue where status in('queued','sending') and due_at<now()-interval '30 minutes'),
 'appointment_uncertain',(select count(*) from private.appointment_reminder_queue where status='uncertain'),
 'appointment_blocked',(select count(*) from private.appointment_reminder_queue where status='blocked'),
 'appointment_failed_last_day',(select count(*) from private.appointment_reminder_queue where status='failed' and updated_at>now()-interval '1 day'),
 'recurring_overdue',(select count(*) from private.recurring_invoice_plans where status='active' and next_date<(now() at time zone timezone)::date),
 'recurring_needs_review',(select count(*) from private.recurring_invoice_plans where status<>'ended' and last_error is not null));
$$;

-- Cover foreign-key lookups for the additive operations and Square tables.
create index expense_invoice_drafts_invoice_fk_idx on private.expense_invoice_drafts(invoice_id);
create index job_activity_actor_fk_idx on private.job_activity(actor_id);
create index job_activity_job_fk_idx on private.job_activity(job_id,business_id);
create index job_budgets_job_fk_idx on private.job_budgets(job_id,business_id);
create index job_tasks_worker_fk_idx on private.job_tasks(business_id,worker_id);
create index job_tasks_job_fk_idx on private.job_tasks(job_id,business_id);
create index job_time_entries_worker_fk_idx on private.job_time_entries(business_id,worker_id);
create index job_time_entries_creator_fk_idx on private.job_time_entries(created_by);
create index job_time_entries_job_fk_idx on private.job_time_entries(job_id,business_id);
create index square_events_operation_fk_idx on private.square_events(operation_id);
create index square_operations_creator_fk_idx on private.square_invoice_operations(created_by);
create index square_operations_invoice_fk_idx on private.square_invoice_operations(invoice_id,business_id);
create index square_operations_payment_fk_idx on private.square_invoice_operations(payment_id);
create index square_oauth_actor_fk_idx on private.square_oauth_states(actor_id);
create index square_oauth_business_fk_idx on private.square_oauth_states(business_id);
create index square_processing_entry_fk_idx on private.square_processing_costs(entry_id);

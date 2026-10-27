-- Cover the primary tenant-scoped list and document-detail queries.
-- These complement existing unique keys and status indexes rather than
-- creating an index for every redundant single-column foreign key.
create index if not exists idx_velnu_invoice_items_detail
  on public.invoice_items (business_id, invoice_id, sort_order);
create index if not exists idx_velnu_estimate_items_detail
  on public.estimate_items (business_id, estimate_id, sort_order);
create index if not exists idx_velnu_payments_invoice_history
  on public.payments (business_id, invoice_id, paid_at desc);
create index if not exists idx_velnu_invoices_recent
  on public.invoices (business_id, created_at desc);
create index if not exists idx_velnu_estimates_recent
  on public.estimates (business_id, created_at desc);
create index if not exists idx_velnu_change_orders_recent
  on public.change_orders (business_id, created_at desc);
create index if not exists idx_velnu_jobs_customer_recent
  on public.jobs (business_id, customer_id, created_at desc);

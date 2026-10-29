-- Staging financial safety guard. Existing totals were checked before applying.
-- Keeps all supported document cents within the frontend's explicit reporting range.
alter table public.invoices add constraint finviant_invoice_supported_total check(total <= 1000000000000);
alter table public.estimates add constraint finviant_estimate_supported_total check(total <= 1000000000000);
alter table public.change_orders add constraint finviant_change_order_supported_total check(total <= 1000000000000);

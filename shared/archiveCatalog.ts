// Version 1 uses explicit fields. Review this catalog whenever a business record schema changes.
export const archiveCatalog=[
  {
    "collection": "private.appointment_reminder_overrides",
    "columns": [
      "appointment_id",
      "business_id",
      "mode",
      "lead_hours",
      "channel"
    ]
  },
  {
    "collection": "private.appointment_reminder_rules",
    "columns": [
      "business_id",
      "actor_id",
      "enabled",
      "lead_hours",
      "channel"
    ]
  },
  {
    "collection": "private.appointment_sms_permissions",
    "columns": [
      "business_id",
      "phone",
      "actor_id",
      "consented_at"
    ]
  },
  {
    "collection": "private.business_card_links",
    "columns": [
      "business_id",
      "actor_id",
      "revision",
      "card",
      "branding",
      "created_at",
      "expires_at",
      "revoked_at"
    ]
  },
  {
    "collection": "private.business_cards",
    "columns": [
      "business_id",
      "revision",
      "details",
      "updated_at"
    ]
  },
  {
    "collection": "private.business_entitlements",
    "columns": [
      "business_id",
      "plan",
      "valid_until",
      "updated_at"
    ]
  },
  {
    "collection": "private.business_onboarding",
    "columns": [
      "business_id",
      "channels",
      "completed_at"
    ]
  },
  {
    "collection": "private.calendar_event_links",
    "columns": [
      "integration_id",
      "source_key",
      "calendar_id",
      "calendar_event_id",
      "generation",
      "updated_at"
    ]
  },
  {
    "collection": "private.calendar_integrations",
    "columns": [
      "id",
      "business_id",
      "user_id",
      "provider",
      "account_id",
      "email",
      "calendar_id",
      "calendar_name",
      "auto_sync",
      "state",
      "last_synced_at",
      "last_error",
      "created_at",
      "updated_at"
    ]
  },
  {
    "collection": "private.change_order_billing",
    "columns": [
      "change_order_id",
      "invoice_id"
    ]
  },
  {
    "collection": "private.change_order_line_revisions",
    "columns": [
      "change_order_id",
      "source_line_id",
      "previous",
      "revised",
      "billed_line",
      "approval_sequence"
    ]
  },
  {
    "collection": "private.customer_invoice_checkouts",
    "columns": [
      "id",
      "business_id",
      "invoice_id",
      "revision_id",
      "request_id",
      "stripe_account_id",
      "livemode",
      "amount_minor",
      "currency",
      "status",
      "stripe_session_id",
      "stripe_payment_intent",
      "payment_id",
      "review_reason",
      "expires_at",
      "created_at"
    ]
  },
  {
    "collection": "private.customer_invoice_refunds",
    "columns": [
      "stripe_account_id",
      "refund_id",
      "checkout_id",
      "amount_minor",
      "refunded_at"
    ]
  },
  {
    "collection": "private.customer_payment_merchants",
    "columns": [
      "business_id",
      "stripe_account_id",
      "livemode",
      "enabled",
      "verified_at",
      "verification_reference"
    ]
  },
  {
    "collection": "private.delivery_preferences",
    "columns": [
      "business_id",
      "user_id",
      "email",
      "phone",
      "email_ready",
      "sms_ready",
      "acknowledged_at"
    ]
  },
  {
    "collection": "private.document_versions",
    "columns": [
      "id",
      "business_id",
      "kind",
      "document_id",
      "revision_number",
      "snapshot",
      "snapshot_hash",
      "created_at",
      "superseded_at",
      "action_expires_at",
      "pdf_bucket",
      "pdf_path",
      "pdf_sha256",
      "pdf_byte_size",
      "pdf_created_at"
    ]
  },
  {
    "collection": "private.expense_invoice_drafts",
    "columns": [
      "expense_id",
      "business_id",
      "invoice_id",
      "created_at"
    ]
  },
  {
    "collection": "private.field_time_submissions",
    "columns": [
      "id",
      "business_id",
      "job_id",
      "visit_id",
      "worker_id",
      "submitted_by",
      "worked_on",
      "minutes",
      "note",
      "status",
      "approved_rate",
      "version",
      "reviewed_by",
      "review_note",
      "created_at"
    ]
  },
  {
    "collection": "private.fin_reviews",
    "columns": [
      "id",
      "thread_id",
      "business_id",
      "user_id",
      "version",
      "steps",
      "status",
      "expires_at",
      "result",
      "created_at",
      "executed_at"
    ]
  },
  {
    "collection": "private.fin_threads",
    "columns": [
      "id",
      "business_id",
      "user_id",
      "revision",
      "last_request",
      "request_text",
      "history",
      "scope",
      "response",
      "updated_at"
    ]
  },
  {
    "collection": "private.invoice_reminder_preferences",
    "columns": [
      "business_id",
      "invoice_id",
      "mode",
      "after_days",
      "repeat_days",
      "max_reminders",
      "updated_at"
    ]
  },
  {
    "collection": "private.job_activity",
    "columns": [
      "id",
      "business_id",
      "job_id",
      "actor_id",
      "event",
      "created_at"
    ]
  },
  {
    "collection": "private.job_budgets",
    "columns": [
      "business_id",
      "job_id",
      "revenue",
      "cost",
      "hours",
      "version",
      "updated_at"
    ]
  },
  {
    "collection": "private.job_completion_reports",
    "columns": [
      "id",
      "business_id",
      "job_id",
      "version",
      "snapshot",
      "created_by",
      "created_at"
    ]
  },
  {
    "collection": "private.job_cost_exclusions",
    "columns": [
      "business_id",
      "job_id",
      "expense_id",
      "reason",
      "created_by",
      "created_at"
    ]
  },
  {
    "collection": "private.job_materials",
    "columns": [
      "id",
      "business_id",
      "job_id",
      "name",
      "quantity",
      "unit",
      "supplier",
      "status",
      "estimated_cost",
      "version",
      "created_at",
      "updated_at"
    ]
  },
  {
    "collection": "private.job_report_photos",
    "columns": [
      "report_id",
      "photo_id",
      "storage_path"
    ]
  },
  {
    "collection": "private.job_task_templates",
    "columns": [
      "id",
      "business_id",
      "name",
      "items",
      "created_at"
    ]
  },
  {
    "collection": "private.job_tasks",
    "columns": [
      "id",
      "business_id",
      "job_id",
      "title",
      "completed",
      "due_on",
      "worker_id",
      "version",
      "created_at",
      "updated_at",
      "priority",
      "visit_id"
    ]
  },
  {
    "collection": "private.job_template_applications",
    "columns": [
      "business_id",
      "job_id",
      "request_id",
      "template_id"
    ]
  },
  {
    "collection": "private.job_time_entries",
    "columns": [
      "id",
      "business_id",
      "job_id",
      "worker_id",
      "worked_on",
      "minutes",
      "hourly_cost",
      "note",
      "created_by",
      "request_id",
      "created_at",
      "version"
    ]
  },
  {
    "collection": "private.managed_delivery_accounts",
    "columns": [
      "business_id",
      "email_active",
      "sms_active",
      "sms_from",
      "reply_to",
      "sms_reply_route",
      "activated_at"
    ]
  },
  {
    "collection": "private.monthly_usage",
    "columns": [
      "business_id",
      "month",
      "documents",
      "ai",
      "voice",
      "email",
      "invoice_estimate_documents"
    ]
  },
  {
    "collection": "private.processing_fee_preferences",
    "columns": [
      "business_id",
      "requested",
      "rate_basis_points",
      "updated_at"
    ]
  },
  {
    "collection": "private.recurring_invoice_occurrences",
    "columns": [
      "id",
      "plan_id",
      "business_id",
      "bill_date",
      "invoice_id",
      "job_id",
      "schedule_error",
      "created_at"
    ]
  },
  {
    "collection": "private.recurring_invoice_plans",
    "columns": [
      "id",
      "business_id",
      "source_invoice_id",
      "created_by",
      "customer_id",
      "property_id",
      "template",
      "title",
      "cadence",
      "anchor_date",
      "next_index",
      "next_date",
      "end_date",
      "due_days",
      "timezone",
      "schedule_visit",
      "visit_time",
      "duration_minutes",
      "workers",
      "status",
      "last_error",
      "created_at"
    ]
  },
  {
    "collection": "private.reminder_rules",
    "columns": [
      "business_id",
      "actor_id",
      "enabled",
      "after_days",
      "repeat_days",
      "max_reminders",
      "updated_at"
    ]
  },
  {
    "collection": "private.scheduling_offer_slots",
    "columns": [
      "id",
      "offer_id",
      "starts_at",
      "ends_at"
    ]
  },
  {
    "collection": "private.scheduling_offers",
    "columns": [
      "id",
      "business_id",
      "estimate_id",
      "property_id",
      "title",
      "assigned_user_ids",
      "status",
      "approved_by",
      "approved_at",
      "expires_at",
      "customer_note",
      "recipient_email",
      "job_id",
      "selected_slot_id",
      "customer_name",
      "booked_at",
      "public_snapshot",
      "confirmed_snapshot"
    ]
  },
  {
    "collection": "private.scheduling_preferences",
    "columns": [
      "business_id",
      "work_days",
      "start_minutes",
      "end_minutes",
      "duration_minutes",
      "buffer_minutes",
      "notice_hours",
      "updated_at"
    ]
  },
  {
    "collection": "private.sms_permissions",
    "columns": [
      "business_id",
      "phone",
      "actor_id",
      "consented_at"
    ]
  },
  {
    "collection": "private.square_connections",
    "columns": [
      "business_id",
      "merchant_id",
      "location_id",
      "location_name",
      "currency",
      "environment",
      "token_expires_at",
      "token_version",
      "enabled",
      "connected_at"
    ]
  },
  {
    "collection": "private.square_invoice_operations",
    "columns": [
      "id",
      "business_id",
      "invoice_id",
      "request_id",
      "created_by",
      "kind",
      "environment",
      "merchant_id",
      "location_id",
      "amount_minor",
      "currency",
      "invoice_total",
      "revision_id",
      "order_id",
      "link_id",
      "provider_payment_id",
      "payment_id",
      "status",
      "review_reason",
      "created_at"
    ]
  },
  {
    "collection": "private.square_payment_refunds",
    "columns": [
      "merchant_id",
      "environment",
      "refund_id",
      "operation_id",
      "amount_minor",
      "refunded_at"
    ]
  },
  {
    "collection": "private.square_processing_costs",
    "columns": [
      "operation_id",
      "amount_minor",
      "entry_id"
    ]
  },
  {
    "collection": "private.support_cases",
    "columns": [
      "id",
      "business_id",
      "reporter_id",
      "title",
      "description",
      "priority",
      "status",
      "version",
      "created_at",
      "updated_at"
    ]
  },
  {
    "collection": "private.support_messages",
    "columns": [
      "id",
      "case_id",
      "audience",
      "body",
      "created_at"
    ]
  },
  {
    "collection": "private.team_audit",
    "columns": [
      "id",
      "business_id",
      "actor_id",
      "action",
      "target_id",
      "created_at"
    ]
  },
  {
    "collection": "private.team_invitations",
    "columns": [
      "id",
      "business_id",
      "email",
      "role",
      "access_modules",
      "created_by",
      "created_at",
      "expires_at",
      "accepted_at",
      "revoked_at",
      "accepted_by"
    ]
  },
  {
    "collection": "private.tier_usage",
    "columns": [
      "business_id",
      "period",
      "feature",
      "used"
    ]
  },
  {
    "collection": "private.worker_profiles",
    "columns": [
      "business_id",
      "id",
      "name",
      "trade",
      "active",
      "is_owner",
      "use_business_hours",
      "work_days",
      "start_minutes",
      "end_minutes",
      "updated_at"
    ]
  },
  {
    "collection": "private.worker_time_off",
    "columns": [
      "id",
      "business_id",
      "user_id",
      "starts_at",
      "ends_at",
      "note"
    ]
  },
  {
    "collection": "public.ai_actions",
    "columns": [
      "id",
      "business_id",
      "user_id",
      "source",
      "raw_input",
      "intent",
      "parsed_payload",
      "status",
      "requires_confirmation",
      "error_message",
      "created_at",
      "confirmed_at",
      "executed_at"
    ]
  },
  {
    "collection": "public.appointments",
    "columns": [
      "id",
      "business_id",
      "job_id",
      "customer_id",
      "assigned_user_id",
      "title",
      "starts_at",
      "ends_at",
      "status",
      "notes",
      "created_at",
      "updated_at",
      "visit_worker_ids",
      "visit_version"
    ]
  },
  {
    "collection": "public.bookkeeping_entries",
    "columns": [
      "id",
      "business_id",
      "created_by",
      "entry_date",
      "direction",
      "amount",
      "currency",
      "category",
      "description",
      "notes",
      "created_at",
      "job_id",
      "estimate_id",
      "invoice_id",
      "source_kind"
    ]
  },
  {
    "collection": "public.business_branding",
    "columns": [
      "business_id",
      "logo_data_url",
      "updated_at"
    ]
  },
  {
    "collection": "public.business_members",
    "columns": [
      "business_id",
      "user_id",
      "role",
      "created_at",
      "access_modules"
    ]
  },
  {
    "collection": "public.business_service_interests",
    "columns": [
      "business_id",
      "selected_services",
      "preferred_plan",
      "updated_by",
      "updated_at"
    ]
  },
  {
    "collection": "public.business_settings",
    "columns": [
      "business_id",
      "payment_links",
      "payment_instructions",
      "updated_at",
      "default_tax_rate",
      "pricing_adjustment_percent",
      "payment_service_setups"
    ]
  },
  {
    "collection": "public.businesses",
    "columns": [
      "id",
      "name",
      "legal_name",
      "email",
      "phone",
      "website",
      "address_line1",
      "address_line2",
      "city",
      "state",
      "postal_code",
      "country",
      "timezone",
      "currency",
      "invoice_prefix",
      "next_invoice_number",
      "estimate_prefix",
      "next_estimate_number",
      "created_at",
      "updated_at",
      "created_by_user_id",
      "change_order_prefix",
      "next_change_order_number",
      "logo_path",
      "business_description",
      "services_offered",
      "service_area",
      "team_size",
      "team_roles",
      "document_accent",
      "document_footer",
      "profile_completed_at",
      "google_review_url"
    ]
  },
  {
    "collection": "public.change_order_items",
    "columns": [
      "id",
      "change_order_id",
      "business_id",
      "description",
      "quantity",
      "unit_price",
      "tax_rate",
      "line_total",
      "sort_order",
      "created_at"
    ]
  },
  {
    "collection": "public.change_orders",
    "columns": [
      "id",
      "business_id",
      "customer_id",
      "job_id",
      "estimate_id",
      "change_order_number",
      "status",
      "title",
      "description",
      "reason",
      "schedule_impact_days",
      "schedule_note",
      "issue_date",
      "subtotal",
      "tax_amount",
      "total",
      "notes",
      "customer_message",
      "sent_at",
      "approved_at",
      "declined_at",
      "created_at",
      "updated_at",
      "request_id",
      "issuer_snapshot",
      "source_invoice_id",
      "change_totals"
    ]
  },
  {
    "collection": "public.customers",
    "columns": [
      "id",
      "business_id",
      "first_name",
      "last_name",
      "company",
      "email",
      "phone",
      "preferred_contact",
      "notes",
      "archived",
      "created_at",
      "updated_at"
    ]
  },
  {
    "collection": "public.document_approval_links",
    "columns": [
      "id",
      "business_id",
      "document_type",
      "estimate_id",
      "change_order_id",
      "expires_at",
      "revoked_at",
      "created_by_user_id",
      "created_at",
      "document_version_id",
      "legacy_pdf_version_id",
      "legacy_entitlement"
    ]
  },
  {
    "collection": "public.document_approvals",
    "columns": [
      "id",
      "approval_link_id",
      "business_id",
      "document_type",
      "estimate_id",
      "change_order_id",
      "action",
      "typed_name",
      "amount_at_action",
      "document_snapshot",
      "user_agent",
      "created_at"
    ]
  },
  {
    "collection": "public.document_schedules",
    "columns": [
      "id",
      "business_id",
      "estimate_id",
      "invoice_id",
      "job_title",
      "description",
      "scheduled_start_time",
      "scheduled_end_time",
      "timezone",
      "status",
      "updated_at"
    ]
  },
  {
    "collection": "public.estimate_items",
    "columns": [
      "id",
      "estimate_id",
      "business_id",
      "description",
      "quantity",
      "unit_price",
      "tax_rate",
      "line_total",
      "sort_order",
      "created_at"
    ]
  },
  {
    "collection": "public.estimates",
    "columns": [
      "id",
      "business_id",
      "customer_id",
      "job_id",
      "estimate_number",
      "status",
      "issue_date",
      "expires_on",
      "subtotal",
      "tax_amount",
      "total",
      "notes",
      "customer_message",
      "created_at",
      "updated_at",
      "request_id",
      "issuer_snapshot",
      "property_id",
      "payment_links",
      "payment_instructions",
      "customer_reference"
    ]
  },
  {
    "collection": "public.invoice_items",
    "columns": [
      "id",
      "invoice_id",
      "business_id",
      "description",
      "quantity",
      "unit_price",
      "tax_rate",
      "line_total",
      "sort_order",
      "created_at",
      "source_estimate_line_id",
      "source_change_order_id"
    ]
  },
  {
    "collection": "public.invoices",
    "columns": [
      "id",
      "business_id",
      "customer_id",
      "job_id",
      "estimate_id",
      "invoice_number",
      "status",
      "issue_date",
      "due_date",
      "subtotal",
      "tax_amount",
      "total",
      "amount_paid",
      "balance_due",
      "notes",
      "customer_message",
      "sent_at",
      "paid_at",
      "created_at",
      "updated_at",
      "payment_links",
      "payment_instructions",
      "request_id",
      "issuer_snapshot",
      "work_completed",
      "work_completed_at",
      "deposit_estimate_id",
      "deposit_source_invoice_id",
      "deposit_credit",
      "property_id",
      "customer_reference"
    ]
  },
  {
    "collection": "public.jobs",
    "columns": [
      "id",
      "business_id",
      "customer_id",
      "property_id",
      "title",
      "description",
      "status",
      "scheduled_start",
      "scheduled_end",
      "completed_at",
      "internal_notes",
      "created_at",
      "updated_at",
      "request_id",
      "assigned_user_ids",
      "source_estimate_id"
    ]
  },
  {
    "collection": "public.messages",
    "columns": [
      "id",
      "business_id",
      "customer_id",
      "invoice_id",
      "estimate_id",
      "direction",
      "channel",
      "recipient",
      "subject",
      "body",
      "provider",
      "provider_message_id",
      "status",
      "sent_at",
      "created_at",
      "change_order_id",
      "email_payload_hash"
    ]
  },
  {
    "collection": "public.payments",
    "columns": [
      "id",
      "business_id",
      "invoice_id",
      "amount",
      "method",
      "provider",
      "provider_payment_id",
      "status",
      "paid_at",
      "notes",
      "created_at",
      "request_id"
    ]
  },
  {
    "collection": "public.properties",
    "columns": [
      "id",
      "business_id",
      "customer_id",
      "label",
      "address_line1",
      "address_line2",
      "city",
      "state",
      "postal_code",
      "access_notes",
      "created_at",
      "updated_at"
    ]
  },
  {
    "collection": "public.quickbooks_connections",
    "columns": [
      "business_id",
      "realm_id",
      "environment",
      "access_expires_at",
      "connected_by",
      "connected_at",
      "updated_at",
      "last_sync_at",
      "last_sync_count"
    ]
  },
  {
    "collection": "public.quickbooks_transactions",
    "columns": [
      "id",
      "business_id",
      "realm_id",
      "source_type",
      "source_id",
      "direction",
      "txn_date",
      "amount",
      "currency",
      "description",
      "source_updated_at",
      "last_seen_at"
    ]
  },
  {
    "collection": "public.record_photos",
    "columns": [
      "id",
      "business_id",
      "job_id",
      "estimate_id",
      "invoice_id",
      "file_name",
      "byte_size",
      "media_type",
      "created_by",
      "created_at",
      "storage_path",
      "expense_id"
    ]
  },
  {
    "collection": "public.reminders",
    "columns": [
      "id",
      "business_id",
      "customer_id",
      "invoice_id",
      "estimate_id",
      "job_id",
      "kind",
      "due_at",
      "status",
      "note",
      "created_at",
      "completed_at"
    ]
  },
  {
    "collection": "public.service_items",
    "columns": [
      "id",
      "business_id",
      "description",
      "unit_price",
      "tax_rate",
      "active",
      "created_at"
    ]
  },
  {
    "collection": "public.service_packages",
    "columns": [
      "id",
      "business_id",
      "name",
      "items",
      "active",
      "created_at"
    ]
  },
  {
    "collection": "public.user_agreement_acceptances",
    "columns": [
      "id",
      "user_id",
      "agreement_version",
      "terms_accepted",
      "ai_disclosure_acknowledged",
      "electronic_records_consent",
      "acceptance_method",
      "accepted_at",
      "selected_tier_at_acceptance"
    ]
  },
  {
    "collection": "public.user_plan_preferences",
    "columns": [
      "user_id",
      "selected_tier",
      "selected_at"
    ]
  },
  {
    "collection": "public.user_profiles",
    "columns": [
      "user_id",
      "full_name",
      "phone",
      "created_at",
      "updated_at"
    ]
  },
  {
    "collection": "public.voice_transcriptions",
    "columns": [
      "id",
      "business_id",
      "user_id",
      "provider",
      "model",
      "transcript",
      "duration_seconds",
      "confidence",
      "created_at"
    ]
  }
] as const

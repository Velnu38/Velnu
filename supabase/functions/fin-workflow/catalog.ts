/** Verified account surfaces. No credentials, arbitrary SQL or platform administration. */
export const accountCatalog = {
  "resources": {
    "customers": {
      "label": "Customers",
      "view": "customers",
      "read_fields": [
        "id",
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
      ],
      "fields": {
        "first_name": {
          "type": "text",
          "max_length": 160
        },
        "last_name": {
          "type": "text",
          "max_length": 160
        },
        "company": {
          "type": "text",
          "max_length": 160
        },
        "email": {
          "type": "email",
          "max_length": 320
        },
        "phone": {
          "type": "text",
          "max_length": 32
        },
        "preferred_contact": {
          "type": "enum",
          "options": [
            "email",
            "sms",
            "phone",
            "none"
          ]
        },
        "notes": {
          "type": "text",
          "max_length": 4000
        },
        "archived": {
          "type": "boolean"
        }
      },
      "module": null
    },
    "properties": {
      "label": "Customer addresses & service locations",
      "view": "customers",
      "read_fields": [
        "id",
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
      ],
      "fields": {
        "label": {
          "type": "text",
          "max_length": 240
        },
        "address_line1": {
          "type": "text",
          "max_length": 240
        },
        "address_line2": {
          "type": "text",
          "max_length": 240
        },
        "city": {
          "type": "text",
          "max_length": 240
        },
        "state": {
          "type": "text",
          "max_length": 240
        },
        "postal_code": {
          "type": "text",
          "max_length": 240
        },
        "access_notes": {
          "type": "text",
          "max_length": 4000
        }
      },
      "create": true,
      "required": [
        "address_line1"
      ],
      "module": null
    },
    "business_profile": {
      "label": "Company profile",
      "view": "company",
      "read_fields": [
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
        "change_order_prefix",
        "next_change_order_number",
        "business_description",
        "services_offered",
        "service_area",
        "team_size",
        "team_roles",
        "document_accent",
        "document_footer",
        "updated_at"
      ],
      "fields": {
        "name": {
          "type": "text",
          "max_length": 240
        },
        "legal_name": {
          "type": "text",
          "max_length": 240
        },
        "phone": {
          "type": "text",
          "max_length": 240
        },
        "address_line1": {
          "type": "text",
          "max_length": 240
        },
        "address_line2": {
          "type": "text",
          "max_length": 240
        },
        "city": {
          "type": "text",
          "max_length": 240
        },
        "state": {
          "type": "text",
          "max_length": 240
        },
        "postal_code": {
          "type": "text",
          "max_length": 240
        },
        "email": {
          "type": "email",
          "max_length": 320
        },
        "website": {
          "type": "url"
        },
        "timezone": {
          "type": "timezone"
        },
        "business_description": {
          "type": "text",
          "max_length": 4000
        },
        "services_offered": {
          "type": "text",
          "max_length": 4000
        },
        "service_area": {
          "type": "text",
          "max_length": 4000
        },
        "team_roles": {
          "type": "text",
          "max_length": 4000
        },
        "document_footer": {
          "type": "text",
          "max_length": 4000
        },
        "team_size": {
          "type": "integer",
          "min": 1,
          "max": 100000
        },
        "document_accent": {
          "type": "color"
        }
      },
      "owner_write": true,
      "module": null
    },
    "document_settings": {
      "label": "Invoice, estimate & payment settings",
      "view": "documents",
      "read_fields": [
        "id",
        "default_tax_rate",
        "pricing_adjustment_percent",
        "payment_links",
        "payment_instructions",
        "updated_at"
      ],
      "fields": {
        "default_tax_rate": {
          "type": "decimal",
          "min": 0,
          "max": 100
        },
        "pricing_adjustment_percent": {
          "type": "decimal",
          "min": 0,
          "max": 100
        },
        "payment_instructions": {
          "type": "text",
          "max_length": 4000
        },
        "payment_links": {
          "type": "payment_links"
        }
      },
      "owner": true
    },
    "invoices": {
      "label": "Invoices",
      "view": "invoices",
      "read_fields": [
        "id",
        "customer_id",
        "job_id",
        "estimate_id",
        "invoice_number",
        "issue_date",
        "due_date",
        "amount_paid",
        "balance_due",
        "work_completed",
        "work_completed_at",
        "sent_at",
        "paid_at",
        "status",
        "subtotal",
        "tax_amount",
        "total",
        "notes",
        "customer_message",
        "payment_links",
        "payment_instructions",
        "issuer_snapshot",
        "created_at",
        "updated_at"
      ],
      "fields": {
        "notes": {
          "type": "text",
          "max_length": 4000
        },
        "customer_message": {
          "type": "text",
          "max_length": 4000
        },
        "issue_date": {
          "type": "date"
        },
        "due_date": {
          "type": "date"
        },
        "payment_instructions": {
          "type": "text",
          "max_length": 4000
        },
        "payment_links": {
          "type": "payment_links"
        },
        "work_completed": {
          "type": "boolean"
        }
      },
      "module": "billing",
      "draft_fields": [
        "notes",
        "customer_message",
        "issue_date",
        "due_date",
        "payment_instructions",
        "payment_links"
      ]
    },
    "estimates": {
      "label": "Estimates",
      "view": "estimates",
      "read_fields": [
        "id",
        "customer_id",
        "job_id",
        "property_id",
        "estimate_number",
        "issue_date",
        "expires_on",
        "status",
        "subtotal",
        "tax_amount",
        "total",
        "notes",
        "customer_message",
        "payment_links",
        "payment_instructions",
        "issuer_snapshot",
        "created_at",
        "updated_at"
      ],
      "fields": {
        "notes": {
          "type": "text",
          "max_length": 4000
        },
        "customer_message": {
          "type": "text",
          "max_length": 4000
        },
        "issue_date": {
          "type": "date"
        },
        "expires_on": {
          "type": "date"
        },
        "payment_instructions": {
          "type": "text",
          "max_length": 4000
        },
        "payment_links": {
          "type": "payment_links"
        },
        "property_id": {
          "type": "reference",
          "resource": "properties"
        }
      },
      "module": "billing",
      "draft_fields": [
        "notes",
        "customer_message",
        "issue_date",
        "expires_on",
        "payment_instructions",
        "payment_links",
        "property_id"
      ]
    },
    "change_orders": {
      "label": "Change orders",
      "view": "change_orders",
      "read_fields": [
        "id",
        "customer_id",
        "job_id",
        "estimate_id",
        "source_invoice_id",
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
        "created_at",
        "updated_at"
      ],
      "fields": {
        "title": {
          "type": "text",
          "max_length": 200
        },
        "description": {
          "type": "text",
          "max_length": 4000
        },
        "reason": {
          "type": "text",
          "max_length": 4000
        },
        "schedule_impact_days": {
          "type": "integer",
          "min": 0,
          "max": 365
        },
        "schedule_note": {
          "type": "text",
          "max_length": 4000
        },
        "notes": {
          "type": "text",
          "max_length": 4000
        },
        "customer_message": {
          "type": "text",
          "max_length": 4000
        },
        "issue_date": {
          "type": "date"
        },
        "items": {
          "type": "line_items"
        }
      },
      "module": "billing",
      "draft_only": true
    },
    "jobs": {
      "label": "Jobs",
      "view": "work",
      "read_fields": [
        "id",
        "customer_id",
        "property_id",
        "title",
        "description",
        "status",
        "scheduled_start",
        "scheduled_end",
        "completed_at",
        "internal_notes",
        "assigned_user_ids",
        "source_estimate_id",
        "created_at",
        "updated_at"
      ],
      "fields": {
        "title": {
          "type": "text",
          "max_length": 200
        },
        "description": {
          "type": "text",
          "max_length": 4000
        },
        "internal_notes": {
          "type": "text",
          "max_length": 4000
        },
        "property_id": {
          "type": "reference",
          "resource": "properties"
        },
        "status": {
          "type": "enum",
          "options": [
            "lead",
            "scheduled",
            "in_progress",
            "completed",
            "canceled"
          ]
        }
      },
      "module": "jobs"
    },
    "appointments": {
      "label": "Calendar entries",
      "view": "schedule",
      "read_fields": [
        "id",
        "customer_id",
        "job_id",
        "assigned_user_id",
        "title",
        "starts_at",
        "ends_at",
        "status",
        "notes",
        "created_at",
        "updated_at"
      ],
      "fields": {
        "title": {
          "type": "text",
          "max_length": 200
        },
        "notes": {
          "type": "text",
          "max_length": 2000
        },
        "starts_at": {
          "type": "datetime"
        },
        "ends_at": {
          "type": "datetime"
        },
        "assigned_user_id": {
          "type": "reference",
          "resource": "workers"
        },
        "status": {
          "type": "enum",
          "options": [
            "scheduled",
            "canceled"
          ]
        }
      },
      "create": true,
      "required": [
        "title",
        "starts_at",
        "ends_at"
      ],
      "module": "calendar"
    },
    "reminders": {
      "label": "Reminders",
      "view": "reminders",
      "read_fields": [
        "id",
        "note",
        "customer_id",
        "job_id",
        "invoice_id",
        "estimate_id",
        "kind",
        "due_at",
        "status",
        "created_at",
        "completed_at"
      ],
      "fields": {
        "note": {
          "type": "text",
          "max_length": 1000
        },
        "due_at": {
          "type": "datetime"
        },
        "status": {
          "type": "enum",
          "options": [
            "pending",
            "completed"
          ]
        }
      },
      "module": "calendar"
    },
    "bookkeeping_entries": {
      "label": "Manual income & expenses",
      "view": "bookkeeping",
      "read_fields": [
        "id",
        "entry_date",
        "direction",
        "amount",
        "currency",
        "category",
        "description",
        "notes",
        "job_id",
        "estimate_id",
        "invoice_id",
        "created_at"
      ],
      "fields": {
        "entry_date": {
          "type": "date"
        },
        "direction": {
          "type": "enum",
          "options": [
            "income",
            "expense"
          ]
        },
        "amount": {
          "type": "decimal",
          "min": 0.01,
          "max": 1000000000
        },
        "category": {
          "type": "text",
          "max_length": 120
        },
        "description": {
          "type": "text",
          "max_length": 4000
        },
        "notes": {
          "type": "text",
          "max_length": 4000
        },
        "job_id": {
          "type": "reference",
          "resource": "jobs"
        },
        "estimate_id": {
          "type": "reference",
          "resource": "estimates"
        },
        "invoice_id": {
          "type": "reference",
          "resource": "invoices"
        }
      },
      "create": true,
      "remove": true,
      "required": [
        "entry_date",
        "direction",
        "amount",
        "category",
        "description"
      ],
      "module": "finances"
    },
    "payments": {
      "label": "Received payments",
      "view": "payments",
      "read_fields": [
        "id",
        "invoice_id",
        "amount",
        "method",
        "provider",
        "status",
        "paid_at",
        "notes",
        "created_at"
      ],
      "fields": {},
      "module": "billing"
    },
    "messages": {
      "label": "Customer communication history",
      "view": "customers",
      "read_fields": [
        "id",
        "customer_id",
        "invoice_id",
        "estimate_id",
        "change_order_id",
        "direction",
        "channel",
        "recipient",
        "subject",
        "body",
        "status",
        "sent_at",
        "created_at"
      ],
      "fields": {},
      "module": "billing"
    },
    "quickbooks_transactions": {
      "label": "Imported QuickBooks transactions",
      "view": "bookkeeping",
      "read_fields": [
        "id",
        "source_type",
        "source_id",
        "direction",
        "txn_date",
        "amount",
        "currency",
        "description",
        "source_updated_at",
        "last_seen_at"
      ],
      "fields": {},
      "module": "finances"
    },
    "workers": {
      "label": "Scheduling team",
      "view": "scheduling",
      "read_fields": [
        "id",
        "label",
        "role",
        "is_you"
      ],
      "fields": {},
      "module": "jobs",
      "manager": true
    },
    "team_members": {
      "label": "Team & access",
      "view": "team",
      "read_fields": [
        "id",
        "email",
        "role",
        "access_modules",
        "primary_owner"
      ],
      "fields": {
        "role": {
          "type": "enum",
          "options": [
            "office",
            "technician",
            "viewer"
          ]
        },
        "access_modules": {
          "type": "modules"
        }
      },
      "owner": true,
      "remove": true
    },
    "team_invitations": {
      "label": "Pending team invitations",
      "view": "team",
      "read_fields": [
        "id",
        "email",
        "role",
        "access_modules",
        "expires_at",
        "created_at"
      ],
      "fields": {},
      "owner": true,
      "remove": true
    },
    "scheduling_preferences": {
      "label": "Working hours & booking rules",
      "view": "scheduling",
      "read_fields": [
        "id",
        "work_days",
        "start_minutes",
        "end_minutes",
        "duration_minutes",
        "buffer_minutes",
        "notice_hours",
        "updated_at"
      ],
      "fields": {
        "work_days": {
          "type": "weekdays"
        },
        "start_minutes": {
          "type": "integer",
          "min": 0,
          "max": 1439
        },
        "end_minutes": {
          "type": "integer",
          "min": 1,
          "max": 1440
        },
        "duration_minutes": {
          "type": "integer",
          "min": 15,
          "max": 720
        },
        "buffer_minutes": {
          "type": "integer",
          "min": 0,
          "max": 180
        },
        "notice_hours": {
          "type": "integer",
          "min": 0,
          "max": 336
        }
      },
      "module": "calendar",
      "manager": true
    },
    "worker_time_off": {
      "label": "Blocked team time",
      "view": "scheduling",
      "read_fields": [
        "id",
        "user_id",
        "starts_at",
        "ends_at",
        "note",
        "created_at"
      ],
      "fields": {
        "user_id": {
          "type": "reference",
          "resource": "workers"
        },
        "starts_at": {
          "type": "datetime"
        },
        "ends_at": {
          "type": "datetime"
        },
        "note": {
          "type": "text",
          "max_length": 200
        }
      },
      "create": true,
      "remove": true,
      "required": [
        "user_id",
        "starts_at",
        "ends_at"
      ],
      "module": "calendar",
      "manager": true
    },
    "calendar_connections": {
      "label": "Connected calendars",
      "view": "calendar",
      "read_fields": [
        "id",
        "provider",
        "email",
        "calendar_name",
        "auto_sync",
        "state",
        "last_synced_at",
        "updated_at"
      ],
      "fields": {},
      "module": "calendar",
      "handoff": "Connection consent, calendar choice, automatic sync and disconnection use Calendar connections. Only the signed-in user\u2019s connections are visible."
    },
    "connected_apps": {
      "label": "Connected app status",
      "view": "settings",
      "read_fields": [
        "id",
        "quickbooks_connected",
        "quickbooks_environment",
        "quickbooks_last_sync_at",
        "quickbooks_last_sync_count",
        "sms_status",
        "plan",
        "subscription_status"
      ],
      "fields": {},
      "owner": true,
      "handoff": "OAuth, SMS verification, subscription billing and external sync require the matching secure account controls."
    },
    "document_approvals": {
      "label": "Customer approvals",
      "view": "estimates",
      "read_fields": [
        "id",
        "document_type",
        "estimate_id",
        "change_order_id",
        "action",
        "typed_name",
        "amount_at_action",
        "created_at"
      ],
      "fields": {},
      "module": "billing"
    },
    "record_photos": {
      "label": "Record photo attachments",
      "view": "work",
      "read_fields": [
        "id",
        "job_id",
        "estimate_id",
        "invoice_id",
        "file_name",
        "byte_size",
        "media_type",
        "created_at"
      ],
      "fields": {},
      "module": "jobs",
      "handoff": "Read file metadata; upload, preview and delete through the related record Photos controls. Do not infer image contents."
    },
    "service_interests": {
      "label": "My services",
      "view": "company",
      "read_fields": [
        "id",
        "selected_services",
        "preferred_plan",
        "updated_at"
      ],
      "fields": {},
      "owner": true,
      "handoff": "Open Company profile > Optional Finviant services to change service preferences. A preference does not activate or purchase a subscription."
    },
    "support_cases": {
      "label": "Help & support",
      "view": "support",
      "read_fields": [
        "id",
        "title",
        "description",
        "priority",
        "status",
        "created_at",
        "updated_at"
      ],
      "fields": {},
      "handoff": "Open Help & support to submit or reply to a case. Fin reads only cases visible to the signed-in reporter or primary owner.",
      "module": null
    }
  },
  "views": {
    "dashboard": {
      "label": "Dashboard",
      "href": "/?view=dashboard",
      "buttons": [],
      "fields": []
    },
    "customers": {
      "label": "Customers",
      "href": "/?view=customers",
      "buttons": [],
      "fields": []
    },
    "invoices": {
      "label": "Invoices",
      "href": "/?view=invoices",
      "buttons": [],
      "fields": []
    },
    "estimates": {
      "label": "Estimates",
      "href": "/?view=estimates",
      "buttons": [],
      "fields": []
    },
    "change_orders": {
      "label": "Change orders",
      "href": "/?view=change_orders",
      "buttons": [],
      "fields": []
    },
    "work": {
      "label": "Jobs",
      "href": "/?view=work",
      "buttons": [],
      "fields": []
    },
    "schedule": {
      "label": "Schedule",
      "href": "/?view=schedule",
      "buttons": [],
      "fields": []
    },
    "reminders": {
      "label": "Reminders",
      "href": "/?view=reminders",
      "buttons": [],
      "fields": []
    },
    "payments": {
      "label": "Payments",
      "href": "/?view=payments",
      "buttons": [],
      "fields": []
    },
    "bookkeeping": {
      "label": "Financial performance & expenses",
      "href": "/?view=bookkeeping",
      "buttons": [],
      "fields": []
    },
    "settings": {
      "label": "Settings",
      "href": "/?view=settings",
      "buttons": [],
      "fields": []
    },
    "company": {
      "label": "Company profile",
      "href": "/?view=settings&section=company",
      "buttons": [
        "Save company profile",
        "Save service preferences"
      ],
      "fields": []
    },
    "documents": {
      "label": "Invoice & estimate setup",
      "href": "/?view=settings&section=documents",
      "buttons": [
        "Save document settings"
      ],
      "fields": []
    },
    "team": {
      "label": "Team & access",
      "href": "/?view=settings&section=team",
      "buttons": [
        "Send invitation",
        "Save access",
        "Remove",
        "Cancel invitation",
        "Resend"
      ],
      "fields": []
    },
    "calendar": {
      "label": "Calendar connections",
      "href": "/?view=settings&section=calendar",
      "buttons": [],
      "fields": []
    },
    "scheduling": {
      "label": "Scheduling & team availability",
      "href": "/?view=settings&section=scheduling",
      "buttons": [
        "Save scheduling preferences",
        "Block time",
        "Remove"
      ],
      "fields": []
    },
    "sms": {
      "label": "Text messaging setup",
      "href": "/?view=settings&section=sms",
      "buttons": [
        "Send verification code",
        "Verify mobile number"
      ],
      "fields": [
        "Owner mobile number",
        "Verification code"
      ]
    },
    "subscription": {
      "label": "Cancel subscription",
      "href": "/?view=settings&section=subscription",
      "buttons": [],
      "fields": []
    },
    "support": {
      "label": "Help & support",
      "href": "/?view=settings&section=support",
      "buttons": [],
      "fields": []
    }
  }
} as const
export type AccountResource = keyof typeof accountCatalog.resources
export type AccountView = keyof typeof accountCatalog.views

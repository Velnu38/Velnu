/** Illustrative examples; no customer actions or network requests. */
export const workflowScenes = [
  {
    "record": "ESTIMATE · EST-1042",
    "status": "Ready for review",
    "copy": "A clear scope and a professional PDF with your logo.",
    "detail": "Prepared for Alex Morgan",
    "value": "$450.00",
    "next": "Review and send directly from Finviant after activation."
  },
  {
    "record": "ESTIMATE · EST-1042",
    "status": "Customer approved",
    "copy": "The customer approves through a private action link.",
    "detail": "Response saved to the estimate",
    "value": "Approved",
    "next": "The estimate status updates in your workspace."
  },
  {
    "record": "JOB · FALL YARD CLEANUP",
    "status": "Appointment selected",
    "copy": "The customer chooses from the times you offer.",
    "detail": "Appointment: Tuesday, 9 AM",
    "value": "Booked",
    "next": "Customer booking updates the job and main calendar."
  },
  {
    "record": "JOB · FALL YARD CLEANUP",
    "status": "Crew assigned",
    "copy": "Jordan and Sam are assigned to the work.",
    "detail": "Hours and time off kept in one place",
    "value": "2 workers",
    "next": "Manage assignments internally; no worker login required."
  },
  {
    "record": "INVOICE · INV-1042",
    "status": "Ready to send",
    "copy": "Review the invoice and send the matching PDF.",
    "detail": "Managed email after sender activation",
    "value": "$450.00",
    "next": "Keep the finished document and follow-up connected."
  },
  {
    "record": "INVOICE · INV-1042",
    "status": "Payment recorded",
    "copy": "An owner records the customer’s payment.",
    "detail": "Balance and financial views reflect payment",
    "value": "$0 due",
    "next": "Manual payment example. Automatic updates need merchant setup."
  }
] as const
export const outcomeScenes = [
  {
    "kicker": "Present your business professionally",
    "title": "Make it easy to say yes.",
    "copy": "Create a clear estimate, send the finished PDF, and give your customer a private approval link. Their response updates the estimate in your workspace—so the next step is clear.",
    "note": "Managed sending requires activation. Examples use fictional business data.",
    "heading": "From proposal to approved.",
    "sub": "Alex Morgan · Fall yard cleanup",
    "rows": [
      [
        "Estimate EST-1042",
        "Scope, line items and your company logo",
        "PDF ready"
      ],
      [
        "Customer approval",
        "Response connected to the estimate",
        "Approved"
      ],
      [
        "Next step: offer a time",
        "Keep the customer and job connected",
        "Ready"
      ]
    ]
  },
  {
    "kicker": "Coordinate people and appointments",
    "title": "A plan your whole office can work from.",
    "copy": "Offer appointment choices after estimate approval. When the customer selects a time, the job and calendar update. Assign one or several workers, plan around availability, and let your authorized office users work in the same account.",
    "note": "Pro includes 25 active internal worker profiles and 5 account users including the owner. Worker profiles do not receive notifications.",
    "heading": "Everyone has a place in the plan.",
    "sub": "Tuesday · Fall yard cleanup",
    "rows": [
      [
        "9:00 AM · Customer appointment",
        "Selected from your offered times",
        "Booked"
      ],
      [
        "Jordan + Sam",
        "Internal crew assignment",
        "2 assigned"
      ],
      [
        "Your office team",
        "Separate, permission-based account access",
        "Up to 5"
      ]
    ]
  },
  {
    "kicker": "Keep the conversation moving",
    "title": "Finish the job. Keep the follow-up.",
    "copy": "Send the reviewed PDF from Finviant, follow delivery updates, and use scheduled sending and reminder rules you enable. Keep the paperwork and the next customer touchpoint in the same workspace.",
    "note": "Managed email, SMS and reminders require sender activation. SMS also requires registration and consent. Beta recipients are restricted.",
    "heading": "The document is only the beginning.",
    "sub": "Invoice INV-1042 · Illustrative delivery",
    "rows": [
      [
        "Your finished invoice",
        "Matching PDF attached to email",
        "Attached"
      ],
      [
        "Delivery activity",
        "Track available provider delivery updates",
        "In one place"
      ],
      [
        "Your reminder rules",
        "You control when follow-up is enabled",
        "Owner set"
      ]
    ]
  },
  {
    "kicker": "Stay on top of the business",
    "title": "See what needs your attention next.",
    "copy": "Keep jobs, estimates, invoices and recorded payments in view. Use Needs Attention and financial history to decide what to follow up on, what to schedule and what is still outstanding.",
    "note": "Payments can be recorded manually. Automatic payment updates need a verified merchant connection; clicking a payment link never marks an invoice paid.",
    "heading": "A clearer view of your next move.",
    "sub": "Example workspace · All figures illustrative",
    "rows": [
      [
        "Estimate EST-1043",
        "Awaiting a customer response",
        "Follow up"
      ],
      [
        "Job · Yard cleanup",
        "Customer appointment confirmed",
        "Scheduled"
      ],
      [
        "Invoice INV-1042",
        "Owner recorded the full payment",
        "Paid"
      ]
    ]
  }
] as const

# Customer reminder defaults: review branch

This is reconstructed source on an isolated branch based on release 6cacfe7. The earlier unpublished workspace was lost; this is freshly tested work, not the original commit. No hosted migrations, worker deployment, activation or real customer messages have occurred.

## Owner workflow

Settings → Customer Reminders separates customer communication from Reminders (internal follow-ups). Invoice defaults initially remain disabled: first email 2 days after due date in the business time zone, then every 7 days, maximum 3. Existing saved rules and custom timing remain intact. Each invoice can inherit, turn reminders off, or customize timing. Invoice delivery remains email only.

Appointment defaults initially remain disabled: 48 elapsed hours before arrival, email or SMS selected by owner. Schedule → Customer reminder provides inherit/off/custom timing and channel for an arrival. Linked rows for one job and arrival share one occurrence and preference. A sibling Off wins; conflicting custom preferences stop sending until resolved. Rescheduling invalidates an existing queued snapshot. Future visits do not depend on the job's next-start summary. PR69 was reviewed for this compatibility, but is not merged into this branch.

Business Pro, owner authorization, active sender, allowance reservation and current customer eligibility are required. SMS additionally needs verified owner/sender, specific appointment-reminder consent for the reviewed current phone number, and no global STOP. Existing one-off document/card SMS permission does not count. This adds no paid service or activation. The implementation uses existing Resend/Twilio services only when separately activated/configured.

## Delivery boundaries

- Enabling may include existing eligible appointments already in their reminder window. Appointments created inside the window are skipped.
- Timing uses elapsed hours; messages display business-local date/time and time-zone name, including DST handling.
- Archived/no-contact customers, canceled/completed work, changed recipients, invalid reply routing, owner/tier/channel changes and unavailable consent fail closed.
- Queue claims are single-attempt; accepted, sending and uncertain operations are not automatically resent. Provider acceptance is not confirmed delivery. Appointment-specific bounce/delivery callbacks are not included.
- A volatile snapshot is rechecked after allowance reservation. Changed state rolls the reservation back. This is not a claim that all cancellation races are eliminated: once claimed, a message may still send. Pause cannot recall in-flight or accepted messages.
- Deleting the canonical appointment keeps durable occurrence suppression. SMS budgeting counts GSM7 septets/UTF16 segments.
- Existing financial PDF/email dispatch remains in place. Appointment SMS can progress when email is disabled; no queue starvation from paused email rows.

## Verification and release limits

Fresh TypeScript, synthetic PostgreSQL/PGlite logic, injected dispatcher and DOM checks are recorded in the evidence JSON. These do not prove deployed full-chain schemas, real concurrent lock waits, provider runtime or physical-device behavior. AUTO-01 stays open.

The manual-only customer-reminder-isolated workflow starts disposable local Supabase without Edge Runtime or provider credentials. It is prepared, not executed. Check available GitHub Actions quota before running to avoid added costs. The existing hosted QA database is behind release and has failed migrations; do not reset that nonempty branch blindly. Apply/reconcile the full chain in an isolated database, validate genuine concurrency and service-role claims, then obtain appropriate release/controlled-send approval before rollout.

Future iOS/Android packaging does not make these push notifications. They remain server-side email/SMS; no OS notification permission or push token is collected. Mobile modal/keyboard/accessibility and store privacy declarations still require app-specific acceptance.

## November 10 integration candidate

Integrated with current Job Management, document, availability and Fin guidance. The existing full migration replay now runs required reminder concurrency checks against final application definitions in its owned disposable database. This replaces the earlier unexecuted manual fixture workflow. Local validation: 63 reminder database/dispatcher checks passed; one optional local fixture concurrency check skipped because no local PostgreSQL is installed. Both reminder DOM journeys, application build and assessment checks passed. Hosted deployment and final integrated CI remain pending. Sending remains owner-controlled and defaults off.

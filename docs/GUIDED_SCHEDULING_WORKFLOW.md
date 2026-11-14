# Guided scheduling and billing workflow

The built-in scheduler is the source of truth. It reuses Finviant's business membership, customer properties, approved estimates, jobs, appointments and email outbox; no new scheduling subscription or AI provider is required.

## Owner and customer experience

1. An approved estimate appears in **Your next steps**, and has a **Schedule job** action. Manual acceptance immediately offers the scheduling step. Nothing is emailed by an approval event alone.
2. The owner or authorized office dispatcher reviews the inherited customer, approved scope and service address, selects the required workers, and chooses the visit length. Working hours, minimum notice, travel buffer, existing Finviant work and blocked time produce appointment suggestions.
3. **Let customer choose** defaults to options on three different dates where available. The owner must explicitly approve the options, address, crew and message before creating an invitation or requesting an email. A changed recipient requires a fresh review. Email uses the same frozen, leased, retry-safe outbox as invoice delivery. Disabled delivery does not queue a message or claim success.
4. The customer opens the scoped invitation, chooses an offered time and enters their name. Booking rechecks current availability inside a business scheduling lock, creates one job and appointment, links the estimate and any existing conversion invoice, and copies the approved scope/site/crew. Options are **not reservations**; stale choices produce a recoverable conflict.
5. **Time already agreed** books directly after explicit owner confirmation without sending a message. Jobs have **Schedule & crew** controls for assigning or rescheduling; the user must separately notify the customer. Calendar and Jobs offer Everyone/My schedule/worker filters.
6. Completing a priced, estimate-linked job prepares one invoice draft; it never automatically sends it. Field staff can complete work without financial read access. A failed draft preparation preserves job completion and presents an office follow-up. An unquoted job prompts the owner to add charges; its customer and scope carry into the invoice form. Existing invoices are reused instead of duplicated.
7. Customers can download an appointment calendar file. Their invitation reflects later internal rescheduling/cancellation; it does not expose staff identities, financial records or internal notes.

Estimates can retain a selected service property. New customers can be added inside estimate/invoice drafts without leaving or discarding line items; a stable identifier makes uncertain-save retries verifiable.

## Dispatch defaults

Defaults are Monday–Friday, 8 a.m.–5 p.m. in the business timezone, a two-hour job, 30 minutes between jobs, and 24 hours' notice. Change them under **Settings → Scheduling & team availability**. Dispatchers can block individual workers' time. Worker selection uses existing named members and does not expand the five Pro-seat limit. Manual crew scheduling can record an agreed appointment outside suggested working hours; it still checks conflicts.

All selected workers must be free. Older scheduled work without an assignment is treated conservatively as busy for all crews until it is assigned. Finviant does not infer travel distances or read external calendar busy data. Existing calendar publishing, once configured, includes secondary crew members and sends field staff to the job rather than a financial document.

## Authorization and reliability

- Private offer/settings/time-off tables have RLS and no browser table privileges. Public RPC wrappers enforce current business membership and relevant modules. Worker assignments are validated against the current roster; removed members cannot be newly scheduled.
- Public customer booking is intentionally a narrow bearer-link operation. The invitation table stores a cryptographically random token's hash; approved email payloads retain their link in the protected outbox for retries. The public function hashes the presented raw token on the server, checks that offer, expiry, status, slot and business before any write, and returns only customer appointment information. A stored hash is not accepted as the raw token.
- Scheduling writes use a per-business advisory lock. Request fingerprints, one-job-per-source-estimate and one-invoice-per-estimate constraints protect retries and duplicate actions. Uncertain sends reuse the saved outbox ID and provider idempotency key.
- Completion and email preparation are service-role-only database endpoints. The Edge Function validates the caller with Auth and supplies the verified actor ID; a browser-supplied actor cannot change authority. Completion responses hide financial identifiers from workers without billing access.
- The existing private deployment and customer-delivery gates remain in force. Creating a link does not remove Vercel protection. External customer access and real provider delivery must be activated and verified in an intentionally approved environment. SMS, native Tap-to-Pay, bank feeds, deposit enforcement and a complete client history portal are separate work.

## Verification

`npm run test:scheduling` covers database booking, conflicting/stale slots, worker availability, cross-business access, changed retries, expiration/revocation, completion/invoice reuse, request authorization and calendar export. `npm run test:calendar` includes secondary crew publishing and field-safe job links. Browser scenarios in `tests/e2e/guided-scheduling.spec.mjs` cover owner approval, direct booking, account-free customer confirmation, conflict recovery, phone layout and inline customer creation. These use controlled fixtures and do not send messages or process payments.

Apply the additive migration and deploy `work-scheduling` to the intended environment before publishing its frontend. Preserve existing private access and validate a rolled-back integration journey against the actual schema. Real provider/device and load evidence remain separate from these checks.

The private staging environment received `20261102221000_guided_scheduling_workflow` on November 2, 2026; `work-scheduling` version 1 is active there. A transaction against the actual schema exercised the owner's approved offer, anonymous customer booking, repeated booking and completion, inherited scope/site/crew, appointment completion and one $105 draft invoice. It also denied a stored-hash replay and browser-only completion. The transaction rolled back all test records and queued no emails. The anonymous security-definer advisory is intentional for the narrow bearer-token endpoint described above; private tables remain inaccessible to browser roles. The existing leaked-password protection warning and foreign-key indexing recommendations remain separate operational follow-ups.

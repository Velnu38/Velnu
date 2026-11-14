# Finviant — recommended three-tier launch offering

> Updated November 8, 2026 (UTC): Business Pro now includes one company E-Business Card with unlimited vCard downloads/device sharing; direct card email counts toward the existing Pro email allowance after activation. Direct card SMS is deferred. Individual now includes 250 manually initiated managed email recipient deliveries/month after sender activation, plus 5 internal worker profiles. Pro includes 25 internal workers and 5 account users. Customer self-booking remains Pro-only. Current release limits and dated follow-ups are maintained in `ASSESSMENT_REPORT.md`.

Prepared November 6, 2026. Recommended names: **Free**, **Individual**, **Business Pro**. Individual corresponds to Basic in existing code; Business Pro corresponds to Pro. Prices are USD per business. Business Pro also offers $399.50 upfront annually (two months free; $79.90 saved). These are recommendations, not active checkout prices or a claim that all tier restrictions and integrations are live. Existing private testers retain their authorized access.

| Plan | Recommended price | Intended customer | Main value |
|---|---:|---|---|
| Free | $0/month | Occasional work or trying Finviant | Complete manual estimate-to-payment workflow for a small customer list |
| Individual | $19.95/month | One busy owner/operator | More capacity, five internal workers, Fin assistance and 250 manual managed email recipients/month after activation |
| Business Pro | $39.95/month | A team or owner who wants automated delivery | Five users, direct sending, customer reminders and larger shared allowances |

The tables below describe recommended inclusion. **Activation** means provider configuration and live validation are required. **Future** means additional development/verification is needed and the feature must not be advertised as available at launch.

## Customers, documents and payments

| Function | Free | Individual | Business Pro |
|---|---|---|---|
| Business workspaces | 1 | 1 | 1 |
| Included users, including owner | 1 | 1 | 5 |
| Active customers | 10 | No advertised count cap | No advertised count cap |
| Customer profiles, contact details, search and history | Included | Included | Included |
| Customer addresses, service locations and Google Maps/directions links | Included | Included | Included |
| Edit/archive/delete controls where record rules allow | Included; preserve linked financial history | Included | Included |
| Manual invoices and estimates | No monthly document cap for included customers | No monthly document cap | No monthly document cap |
| Multiple line items, taxes, totals, due dates and customer terms | Included | Included | Included |
| Draft review, correction, preview and document timestamps | Included | Included | Included |
| Copy Link, PDF download and printing | Included | Included | Included |
| Customer estimate approval links and approval history | Included | Included | Included |
| Approved estimate → draft invoice; original estimate retained | Included | Included | Included |
| Deposit invoice and final invoice deposit credit | Included | Included | Included |
| Change orders linked to the original job/document | Included | Included | Included |
| Payment instructions and external payment links: supported PayPal, Venmo, Cash App and Stripe destinations | Included | Included | Included |
| Mark Paid, partial-payment recording and remaining balance | Included | Included | Included |
| Work Completed tracking | Included | Included | Included |
| Overdue invoice and estimate attention indicators | Included | Included | Included |
| E-Business Card: one company vCard, unlimited downloads/device sharing | — | — | Included; owner edits, authorized office users share |
| Company name/contact information on documents | Included | Included | Included |
| Uploaded company logo and removal of Finviant promotional branding | No; retain Finviant branding | Included | Included |
| Account setup, security, agreement acceptance, help and support requests | Included | Included | Included |
| Saved-record access and document download after usage allowance is exhausted | Included | Included | Included |

Payment links lead to the business's payment provider. **Mark Paid records money already received; it does not charge the customer.** Provider transaction fees are separate. Automatic payment reconciliation and native Tap to Pay require their own activation/development and must not be implied by this row.

## Sending and automation

| Function | Free | Individual | Business Pro |
|---|---|---|---|
| Same invoice/estimate workflow and Send Email / Send Text controls | Included | Included | Included |
| Personal email/text app sharing | Included; user finishes sending in app | Included; user finishes sending in app | Included as an alternative |
| Finviant charge or message quota for personal-app handoffs | No Finviant message charge/cap; own provider limits apply | Same | Same |
| Send directly from Finviant through Resend/Twilio | Not included | Email only; manual sends after activation | Email and SMS after activation |
| Included managed customer emails | 0 | 250 recipient deliveries/month; manual sends | 2,000 recipient deliveries/month |
| Included managed customer texts | 0 | 0 | 200 US SMS segments/month |
| Managed delivery status and failure handling | Not applicable to personal apps | Included for managed email after activation | Included after activation |
| Automatic overdue invoice email reminders | No; manual sharing available | No; manual sharing available | Included after activation and owner enables rules |
| Scheduled/background customer email dispatch | Not included | Not included | Included after activation |
| Authentication/password-reset and essential service emails | Included separately | Included separately | Included separately |
| Extra managed messages | Paid plan required for managed email | Pro increases email capacity; no automatic purchase | Optional prepaid purchase is not active; rates must be disclosed before any future purchase |

Use identical controls with concise route-specific help: “Opens your app to finish sending” or “Sends directly from Finviant.” Native-app sharing cannot silently send in the background, reliably prove delivery, or replace the user's final Send action. Recipients, resends and reminders count against managed allowances; texts count by billable segments, not conversation bubbles. Do not market these allowances as unlimited sending. SMS sender setup/registration, recipient consent, opt-outs and reply routing are separate activation requirements. Confirm actual fixed sender costs before promising an included dedicated number or setting a setup fee.

## Jobs, scheduling, Fin and finances

| Function | Free | Individual | Business Pro |
|---|---|---|---|
| Job records, status, work details, materials and notes | Included for permitted work | Included | Included |
| Scheduled jobs | 5/month | No advertised monthly count cap | No advertised monthly count cap |
| Calendar day/week/month views and manual calendar entries | Included | Included | Included |
| Internal reminders and Needs Attention | Included | Included | Included |
| Approved estimate → scheduled job; completed job → draft invoice | Included within job allowance | Included | Included |
| Working hours, time off, booking notice and travel buffers | Basic owner availability | Included for up to 5 internal workers | Included for up to 25 internal workers |
| Customer choice of offered appointment times / guided scheduling | Not included; manual owner booking remains available | Not included; manual owner booking remains available | Included; managed sharing after activation |
| Recurring invoice drafts and optional associated scheduling | Not included | Included; user sends each occurrence | Included; review each recurring draft before scheduling its email |
| Google Calendar / Microsoft Outlook connections | Not included | After activation | After activation |
| Internal worker assignment | Owner only | 5 active profiles; no additional logins | 25 active profiles; no worker login/notification implied |
| Account invitations, roles and module permissions | Owner only | Owner only | 5 account users including owner; primary owner manages access |
| Fin: typed assistant, business questions and saved-record lookup | 20 introductory requests once | 150 requests/month | 600 requests/month shared |
| Fin: reviewed invoice/estimate drafts and supported account changes | Uses same Fin allowance | Uses same Fin allowance | Uses same Fin allowance |
| Speak to Fin / voice document creation | 10 introductory minutes once | 60 minutes/month | 180 minutes/month shared |
| Multi-line voice drafts, editable review and calculated totals | Included within Fin/voice allowance | Included within allowance | Included within allowance |
| Manual income and expense entry, including + Add Entry | Included | Included | Included |
| Job/invoice/estimate expense attachment and receipt photos | Included within storage allowance | Included within storage allowance | Included within storage allowance |
| Financial Performance summary | Most recent 30 days | Full available history | Full available history |
| Detailed income/expense drill-down, date filters and available historical charts | Basic summary only; own saved records retained | Included | Included |
| QuickBooks Online read-only import | Not included | After activation; separate Intuit subscription | After activation; separate Intuit subscription |
| Advanced job profitability reporting | Not included | Not included | Future |
| Full customer portal combining all records | Not included; individual document links included | Future option | Future |
| Native Tap to Pay, offline synchronization, app-store apps | Not included at launch | Future; packaging undecided | Future; packaging undecided |

The Financial Performance feature reports recorded income and expenses. Do not describe it as a complete accounting system or tax-ready profit-and-loss statement. Core calendar/workbook use is included at the levels above; do not silently reintroduce older optional scheduling/bookkeeping assistant fees. Fin assistance uses the stated combined request allowance. It still requires review for consequential changes; “Business” does not imply unrestricted autonomous spending or messaging.

## Storage and allowance rules

| Function / limitation | Free | Individual | Business Pro |
|---|---|---|---|
| Total retained attachment storage per business | **100 MB** | **2 GB** | **10 GB** |
| Maximum incoming photo | 10 MB | 10 MB | 10 MB |
| Hosted logo limit | Not included | 2 MB | 2 MB |
| Supported photos | JPG, PNG, WebP | JPG, PNG, WebP | JPG, PNG, WebP |
| Photo compression/resizing | Included | Included | Included |
| Shared usage meter, warnings at 80% and 95% | Included | Included | Included |
| At full storage allowance | Pause new uploads; retain existing records and payment access | Same | Same |
| Automatic deletion or automatic overage charges at quota | Neither | Neither | Neither |
| Extra storage | Upgrade, or separately offered capacity | Separately offered capacity | Separately offered capacity |

Storage is cumulative, not a monthly allowance, and Business users share the same 10 GB. Decimal units apply: 1 GB = 1,000,000,000 bytes. Count stored compressed photos and hosted logos; reserve bytes for unconfirmed uploads. Core database records do not consume the attachment allowance. Ten GB holds roughly 10,000 pictures at 1 MB, 5,000 at 2 MB, or 2,000 at 5 MB before other attachments/logos. File size varies; these are estimates, not guaranteed photo counts.

Monthly Fin, voice, email and SMS allowances should reset on the billing cycle without rollover; Free introductory Fin/voice allowances are once per business and do not renew. Voice processing can consume both transcription minutes and a Fin request. Exhausting AI or delivery allowances must not stop manual work or opening saved records. Five scheduled jobs means five job occurrences scheduled within the billing month; rescheduling the same occurrence should not count twice. Archived customers retain history but cannot be used to bypass the active-customer allowance. Existing private testing grants remain a separate entitlement.

Additional seat/storage/message prices, annual subscriptions and overage auto-purchase are not activated by this recommendation. Start with monthly billing and review real provider, support, storage and active-Free-account costs before promising long-term discounts. Do not advertise unlimited AI, storage, SMS or a dedicated business number until costs and activation are verified.

## Setup, agreements and release status

Free and Individual require a compatible, configured personal email/text app on each device used for sending. Business requires approved managed senders, business identity setup, recipient permissions, reply routing and enabled automation rules. Show delivery method and allowances in marketing, plan selection, onboarding and the agreement. Record agreement version and acceptance time; owner agreement acceptance does not replace customer SMS consent.

The chart updates the recommended offering and supersedes conflicting historical proposals in this report for recommendation purposes only. Tier enforcement and private owner testing are now implemented as described below. Subscription checkout, provider activation, complete customer/provider end-to-end testing, backup restoration, public launch and native-store readiness remain distinct release gates. Code presence and a passing local test do not establish that a third-party integration is active. No provider payment or customer message should be sent merely to verify the chart.

## Implemented private tier testing

Settings → Plans & Usage provides Test Free, Test Individual and Test Business Pro to an authorized private-testing primary owner. The effective tier is enforced on the server. Restore access returns to the original entitlement. Changing tiers does not charge the owner, reset usage or delete records. One-user tiers suspend other team members; Business Pro restores eligible memberships.

Email & Text Setup appears after company onboarding and remains accessible in Settings. Personal-app drafts need a final Send in the configured app. Only explicit user confirmation records a personal send; delivery remains unverified. Customer links expire after 30 days and are invalidated by changed document content. Site-level private access protection still applies.

Managed SMS, scheduled customer email and opt-in overdue invoice email reminders are implemented with quotas and server-side sender activation checks. Real provider sending remains paused until sender registration, replies, delivery webhooks and activation are verified. Automatic appointment/estimate follow-ups and automatic dispatch of every recurring occurrence are not included in this implementation. Manual scheduling invitations and recurring draft generation remain available as shown above.

No Stripe subscription checkout or automatic paid activation is introduced by tier testing. No prepaid top-ups or automatic overage charges are enabled.

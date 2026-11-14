# Controlled email and SMS acceptance

Step 15's controlled email checks ran on November 10, 2026 against the existing private-beta release `c47fbe69f3ec00ef94b6b1070c9853d82a4dcfdd`, READY deployment `dpl_F8MUArgNDqmxUYkqqhh4GmTsifdJ`. The owner supplied one controlled email address and mobile number and authorized three emails, two SMS messages, a $1 total ceiling and no new subscriptions. Private contact details and share tokens are excluded from repository evidence.

## Observed result

| Check | Result |
| --- | --- |
| Invoice email | Delivered once; canonical $0 test PDF attached; signed sent/delivered callbacks recorded. |
| Estimate email | Delivered once; canonical $0 test PDF attached; signed sent/delivered callbacks recorded. |
| E-Business Card email | Delivered once; valid vCard attachment matches the existing immutable card preview. |
| Customer document links | Both anonymous share reads returned HTTP 200; both PDF downloads exactly match emailed attachment bytes and immutable stored SHA-256. |
| Estimate decision availability | Share reports the decision available with an approval token. No approval or work order was submitted. |
| SMS card and appointment | Not sent: workspace SMS inactive, with no sender or reply route; registration/balance unverified. No activation or paid setup attempted. |
| Usage and cost | Daily usage advanced from 0 to 3 of 100; monthly from 5 to 8 of 3,000. All three fit the included allowance, for $0 incremental sending cost. |

The natural five-minute delivery cron processed the three application outbox requests at approximately 23:25 UTC. Each had exactly one approved recipient, no CC/BCC and one dispatch attempt. The provider independently reports all three delivered, and the application has the corresponding six signed sent/delivered receipts. No retry, direct-provider duplicate or unrelated recipient send was introduced. Safe receipt references, timestamps, hashes and checks are in `docs/evidence/2026-11-10-controlled-email-delivery.json`.

The synthetic invoice and estimate explicitly state that no goods or services were ordered. The invoice requires no payment and contains no payment links; the estimate says not to approve it as real work. Both PDFs were rendered and visually inspected: one page each, readable layout, zero totals, no clipping/overlap, and centered Thank You footers. The synthetic customer/documents remain for owner inspection and audit evidence. Saved card details were not edited; its preview expires after the existing 90-day period, while the vCard can be saved permanently.

## Method and limits

This was backend-assisted acceptance using existing privileged preparation RPCs for the authorized owner's workspace. Normal membership, plan/quota, beta-recipient, immutable-version, leased-dispatch and signed-webhook controls remained in place. No active browser login was available. This establishes the live backend delivery path and public link/PDF API behavior, not the owner-side browser Send journey or physical-device acceptance.

The owner subsequently confirmed receipt of the emails in this conversation. Provider delivery alone would not establish that result. Attachment usability in the owner's phone mail app, reply routing and phone contact import remain unconfirmed. The estimate decision was inspected read-only; no customer decision, booking, payment or real work was authorized by this test. Auth signup/recovery email is a separate acceptance flow and was not triggered.

The connected Resend domain reports sending enabled, verified DKIM/SPF/MX/CNAME and open/click tracking disabled. Public DMARC is `v=DMARC1; p=none; adkim=r; aspf=r`, a monitoring policy. Domain transfer, DNS policy changes, general beta-recipient expansion and SMS activation were not part of this test.

EMAIL-01 remains open for remaining reply/auth/inbox/error/quota and broader acceptance criteria. SMS-01 remains blocked by sender setup and subsequent controlled live acceptance. Existing isolated invalid-signature/replay/suppression/error/quota fixtures remain separate evidence; no intentionally failing messages were sent to a real recipient. Do not resend an uncertain delivery without reconciling existing request/provider receipts first.

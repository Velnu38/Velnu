# Private beta email

Finviant's protected `finviant.com` private beta uses the staging backend `xvybcmyoblfgzokaifsx`. Managed email uses Resend with the verified `finviant.com` sender and the existing `resend-events` webhook. It requires Business Pro access; Free and Individual continue using personal email apps.

## Release configuration

| Location | Setting | Scope |
| --- | --- | --- |
| Vercel | `VITE_ENABLE_PRIVATE_BETA_EMAIL=true` | Preview, exact branch `ux/private-testing-20261029` |
| Vercel | `VITE_ENABLE_CUSTOMER_ACTIONS=false` | General customer actions remain gated |
| Staging Edge Functions | `FINVIANT_PRIVATE_BETA_EMAIL_ENABLED=true` | Enables the staging email dispatcher |
| Staging Edge Functions | `FINVIANT_CUSTOMER_EMAIL_ENABLED` absent/false | The production release switch remains off |
| Staging Edge Functions | `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET` | Existing provider credentials; never expose in frontend or source |
| Staging database | `private_beta_email_delivery=true`, `ten_pro_test_accounts=true` | Enables registered tester enrollment and recipient checks |

The build rejects the beta flag on production, other preview branches, development targets, and unregistered backends. This does not change the Supabase project, Vercel authentication, search-indexing headers, SMS activation, or scheduling-invitation release controls.

## Workspace activation and recipients

Only workspaces owned by a registered private-beta account with a confirmed email can enroll. The operator-controlled enrollment helper activates email, sets the confirmed owner's address as reply-to, and approves that address for the workspace. It preserves SMS activation settings. New workspaces enroll through a database trigger when both beta flags are enabled; existing workspaces can be enrolled by the database administrator.

The private recipient table is `private.private_beta_email_recipients`. Additional real tester addresses require administrator approval for that specific workspace. The exact provider test addresses `delivered@resend.dev`, `bounced@resend.dev`, and `complained@resend.dev` are available for controlled provider tests. Other addresses on `resend.dev` are not implicitly approved.

All envelope recipients, including CC and BCC, must be approved. A database insert guard runs before usage reservation. The shared dispatcher rechecks the frozen outbox immediately before a provider request, including retries, recovery, and scheduled work. Removing approval, test enrollment, the beta flag, Pro access, or email activation stops subsequent dispatch. Client roles cannot read or edit recipient approvals or call the privileged approval RPC.

The normal review flow, persistent send identifier, recipient snapshot, membership checks, quota, Resend idempotency key, signed callbacks, and duplicate-event handling still apply. Rejected beta recipients produce a clear message and no provider request. A fresh send identifier is allowed only after a database-locked stop proves that the first attempt never contacted the provider. Prior uncertain attempts retain their original identifier and pause for reconciliation, including when approval is later revoked. The server supplies an explicit `beta_send_not_started` proof marker only for a confirmed safe stop or a pre-queue rollback.

## Verification and rollback

Run deployment-isolation, beta-email SQL and dispatcher tests, the focused browser tests, and the app build before deployment. Verify a live invoice send from the protected site to `delivered@resend.dev`, then correlate the Resend email ID with the saved message, outbox status, and `email.delivered` receipt. A test-recipient simulation verifies provider transport and app state; it does not establish delivery into a real customer inbox.

To pause email, disable `FINVIANT_PRIVATE_BETA_EMAIL_ENABLED` and the database `private_beta_email_delivery` flag. To remove the buttons, disable the preview branch's `VITE_ENABLE_PRIVATE_BETA_EMAIL` and rebuild. Keep existing outbox rows and event receipts for reconciliation. Production activation is a separate release.

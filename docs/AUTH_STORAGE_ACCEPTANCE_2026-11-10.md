# Genuine Auth and Storage acceptance

The mandatory disposable Supabase replay now exercises actual local Auth, PostgREST and Storage, after applying every unmodified application migration. Three synthetic users sign in with generated passwords and receive genuine sessions; no custom JWT signing or role-only impersonation replaces these requests.

The checks cover owner invoice creation and retry, unrelated tenant read/write denial, office billing access, actual private PNG upload/download with SHA-256 comparison, anonymous/foreign file denial, foreign signed-link creation denial, and module/membership revocation while the same session remains signed in. Only setup and authorized role changes use the owned database administrator. The final database cleanup still requires zero users, businesses, payments and storage objects.

Connections are restricted to the newly created local API at `http://127.0.0.1:54321` and existing owned local database guard. HTTP redirects are rejected. Keys come only from that disposable CLI status, stay in memory and never appear in receipts. No hosted account, provider, email recipient, payment or customer file is used. The local workspace lacks Docker; URL guards can run here, but the actual stack check must pass in CI before being described as verified.

This evidence remains narrower than complete SEC-02: physical-device behavior, independent hosted-environment review, every supported role and endpoint, public approval/payment capability lifecycles, refresh-token expiry and a full database/Storage restore still require their own acceptance. Previously issued signed download URLs have their own expiry; revoking membership is not described as instantaneous revocation of a valid bearer download link.

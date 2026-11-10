# Bounded customer search in job drafts

Jobs no longer loads the full customer directory on entry or queue refresh. A scoped customer link resolves its selected contact through a bounded read. The Create job and Schedule job forms use eight server-selected suggestions with the existing customer picker, keyboard selection, inline customer creation, service-address selection and draft protection.

The additive `search_job_customers` RPC runs as the caller, retains customer row policies, and checks current membership and Jobs permission. It returns only contact identity/name/company/email/phone, at most eight matches plus one selected active customer. Literal search supports names in either order, company, email, formatted telephone digits and accent normalization. Archived and foreign selected contacts are not returned. It does not select a customer automatically from an ambiguous name.

Search is debounced; stale requests cannot overwrite newer results. Loading/error states hide obsolete options, preserve the job draft and provide retry. Newly created customer selections and customer-scoped entry are preserved. Other app customer directories and selectors are unchanged.

Validation: 50,001 synthetic contacts plus named, archived and foreign sentinels; bounded result size; accented name, reversed tokens, literal percent, email and phone search; active selected contact outside results; anonymous, foreign and revoked-job permission denial. The fixture also revokes the internal record guard, matching hosted grants; this caller-rights function uses the separately granted membership helpers and existing customer RLS instead. Genuine Auth/PostgREST replay and phone/desktop browser tests cover the actual new API contract. Build/startup and existing operations DOM tests passed locally; full CI and hosted rollout remain pending.

This removes the Jobs screen's customer scan. It does not claim that every remaining app directory is paginated or that a 50,000-contact server search meets a measured production latency target.

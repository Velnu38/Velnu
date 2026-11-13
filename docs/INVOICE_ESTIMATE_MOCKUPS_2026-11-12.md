# Invoice and estimate mockup rollout

Owner authorized implementation and private-beta deployment of the two generated Job Management-style document mockup boards on November 12. Release Invoices, verify live assets, then release Estimates.

Invoice released: responsive two-column summary and record cards, searchable/status-filtered list, large create action, Details/Photos & expenses/Activity tabs, financial summary and PDF/payment/change/job shortcuts. Full-screen create/edit/review forms retain all existing inputs and safeguards. Applied payments are labeled truthfully, not confused with net funds after refunds. Paid/overdue, recurring, deposits, recovery, reminder history, draft save/preview and all existing provider/role gates remain. No automatic sends/charges, backend or calculation changes.

Focused Chromium/WebKit rendered list/detail/resources/activity/create checks and existing draft/history regressions must pass before release. Local browser launch was previously blocked by process-singleton socket permissions in this executor; hosted browser evidence is required. Physical-device/signed-in owner acceptance remains open.

Invoice PR111 source 94e31549073cbd91c4e061c8cbe13ced4cc56c11 matches reviewed candidate tree 01180c914fb1743ce0a7b6ff6ab53addca7c59cf. Focused run 43339156968: 13 passed per engine. Vercel dpl_3agkc3Yi9udrEfBbCaSg92FmniZL READY; finviant.com and www.finviant.com both alias this deployment, HTTP200, exact InvoicesPage-BpKNB4Hf.css SHA256 628307ed6ee362cba8a831108e31a2f0f76f2604c7e5c7559a8c368053869d48, beta backend and privacy headers confirmed.

Estimate candidate follows as the second release: real sent/approved value plus record counts, retained pending-value and declined filters, four primary status tabs, detail summary and existing PDF/linked-job/change/activity actions, full-screen existing native dialogs. Approval status/workflow and all provider, revision, scheduling, deposit and conversion safeguards are unchanged. Verification pending. Existing Job Management, PR107 Home, PR108 Fin/performance, Jobs directory work and open stationery PR70 remain separate.

# Invoice and estimate mockup rollout

Owner authorized implementation and private-beta deployment of the two generated Job Management-style document mockup boards on November 12. Release Invoices, verify live assets, then release Estimates.

Invoice released: responsive two-column summary and record cards, searchable/status-filtered list, large create action, Details/Photos & expenses/Activity tabs, financial summary and PDF/payment/change/job shortcuts. Full-screen create/edit/review forms retain all existing inputs and safeguards. Applied payments are labeled truthfully, not confused with net funds after refunds. Paid/overdue, recurring, deposits, recovery, reminder history, draft save/preview and all existing provider/role gates remain. No automatic sends/charges, backend or calculation changes.

Focused Chromium/WebKit rendered list/detail/resources/activity/create checks and existing draft/history regressions must pass before release. Local browser launch was previously blocked by process-singleton socket permissions in this executor; hosted browser evidence is required. Physical-device/signed-in owner acceptance remains open.

Invoice PR111 source 94e31549073cbd91c4e061c8cbe13ced4cc56c11 matches reviewed candidate tree 01180c914fb1743ce0a7b6ff6ab53addca7c59cf. Focused run 43339156968: 13 passed per engine. Vercel dpl_3agkc3Yi9udrEfBbCaSg92FmniZL READY; finviant.com and www.finviant.com both alias this deployment, HTTP200, exact InvoicesPage-BpKNB4Hf.css SHA256 628307ed6ee362cba8a831108e31a2f0f76f2604c7e5c7559a8c368053869d48, beta backend and privacy headers confirmed.

Estimate released as the second release: real sent/approved value plus record counts, retained pending-value and declined filters, four primary status tabs, detail summary and existing PDF/linked-job/change/activity actions, full-screen existing native dialogs. Approval status/workflow and all provider, revision, scheduling, deposit and conversion safeguards are unchanged. Existing Job Management, PR107 Home, PR108 Fin/performance, Jobs directory work and open stationery PR70 remain separate.


Final estimate/shared document receipt: PR113 merged eb0057142f3bce99984ae00a220119acdcbb4276; exact tested tree 317382cc2df5ab38d55b1f77a866694752480327 and candidate 976bf64042a1b0498e387722c063c11b18db9139. Shared styling also aligns native document dialog branding, PDF tile dimensions and persistent primary/More actions. Outside document phone screens, existing dialog appearance remains.

Local validation: TypeScript; production build and 95 startup checks; 11 estimate action tests; estimate six-state record DOM and invoice lifecycle/refund/recovery DOM checks; assessment sync/test/check. Focused run 43341779976 passed 16 cases per Chromium/WebKit engine, including final list/detail/resources/activity/create captures at 320, 390 and 430px and estimate primary-action visibility. Chromium artifact13999332728 and WebKit artifact14000451216 provide synthetic rendering evidence. Initial invoice broad regression run43339157009 also passed.

Final Vercel dpl_3ZnhT117recH7woHCvYVsHZKs76M is READY, preview target, source eb0057142f3bce99984ae00a220119acdcbb4276. finviant.com and www.finviant.com aliases resolve to this project/deployment; both HTTP200, same entry, private/no-store and noindex headers. Live App bundle uses beta backend xvybcmyoblfgzokaifsx and does not use production backend qusmeexjbwphoezlcmie. Live invoice/estimate chunks return200 with document phone classes/summary. Exact CSS comparisons: index-DTlNujVe.css SHA256 fd904642429ffd1dee1fe7c8adcc4274537702b6f2301729b0380237e6f4649e; shared document CustomerEntry-Csc3atLe.css SHA256 031e9d46cccfda087842a70d2b91581704f96f86c1467d7743107baccd8511a3.

No email/approval was sent, money moved, provider/backend configuration changed, or production cutover performed. Screenshots use controlled synthetic records. Signed-in owner and physical-device acceptance remain open.

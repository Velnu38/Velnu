# Fin contextual navigation — card 03

Clear typed requests and transcribed speech share the same navigation resolver. Examples: “Open customer reminders”, “Take me to calendar connections”, “Open job management”, and “Open jobs directory”. Customer reminders open `/?view=settings&section=customer_reminders`; internal follow-ups open `/?view=reminders`. Jobs explicitly selects `workspace=jobs`, and Job Management selects `workspace=management`, regardless of the remembered tab.

“Open that” and “Take me there” refer to the last destination successfully opened, or one unambiguous supported destination in the latest Fin answer. A new answer clears older navigation context; multiple, unknown or generic reminder suggestions do not supply a destination. Without that context, Fin asks which page. “Open reminders” asks whether the owner means customer messages or internal follow-ups. Unsupported destinations and record-specific direct-opening requests explain the limitation instead of inventing a route. Existing invoice draft/source handoffs, account questions and searches remain available. No arbitrary model-provided URL is executed.

Navigation rechecks current authenticated membership, business identity, module access and Fin plan availability. Destination permissions and data authorization remain in the existing pages/services. Only the Fin input is excluded from the shared navigation guard; unrelated unsaved edits still offer discard/cancel and busy saves remain protected. A pending action review must be completed or canceled. Repeated navigation to the same page does not append browser history or reset its edits.

Opening any destination does not create records, save settings, enable reminders, send messages or charge a customer. Customer-reminder creation/setup requests without record details open the supported setup screen for review; they never silently enable a rule. Worker profiles and account access retain their existing separation.

## Evidence boundaries

- `tests/settings/fin-navigation.test.ts`: exact routes, bounded context, missing/ambiguous destinations, consequential-action exclusion, tenant/role/module/plan denial.
- `tests/e2e/fin-navigation.spec.mjs`: desktop/mobile exact destinations, repeated requests, Back and reload, cancellation/discard of unrelated edits, fresh denial and synthetic browser dictation.
- Existing Fin workflow, financial review, voice recovery and microphone regression tests remain applicable.
- Tests use synthetic auth/data and intercepted services. No real provider call, real recipient, paid activation, hosted two-owner acceptance or physical iPhone/Android test is claimed. AI-01 and AI-02 remain open independently of these navigation checks.

The first hosted navigation run identified an incomplete appointment-settings fixture and a test race that registered both native-dialog handlers before the first prompt arrived. The fixture now supplies the existing RPC contract; the cancellation check explicitly awaits dismissal before retrying. No reminder engine change was made in card 03.

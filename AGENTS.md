# Finviant project maintenance

Keep the current launch assessment accurate as part of completing work.

- `docs/launch-readiness.json` is the canonical task/evidence registry. `ASSESSMENT_REPORT.md` is generated; do not append historical release narratives or reintroduce completed work as open tasks.
- When a task's complete acceptance criteria are actually verified, use `npm run assessment:complete -- ID --evidence "dated test/provider receipt reference"`. It records the current Git commit and date. Add enough evidence references to cover every criterion. Reopen regressions with `npm run assessment:reopen -- ID --reason "failure evidence"`.
- A source file, configuration variable, mocked test, READY deployment or cron dispatch is not evidence of live-provider success, tenant isolation, physical-device acceptance, a restore drill or measured load capacity. Keep partial/unknown gates open; document access limitations.
- Update observations and add new relevant launch tasks after material changes. Remove a completed item from the displayed backlog by recording `done`, not by deleting its acceptance/evidence history.
- Run `npm run assessment:sync`, `npm run assessment:test`, and `npm run assessment:check`; commit the registry/report with the implementation and evidence. Review existing user authorization before provider writes, sending messages, paid changes, production cutovers or load tests.
- Never put credentials, customer records, contact/share/OAuth tokens, raw audio or privileged logs in evidence. Use immutable code/test receipt references and safe aggregates.

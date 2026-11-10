# Verified private-beta release

The application source remains the exact tested tree: candidate `0bb6ff2963edea6bfeae97cafefaa8f6836a398e`, merged/released as `b2fe20ce0b9d36806b7e94231eed962322eb6f55`. Vercel deployment `dpl_FR471eC4y8xzy3PQGiSDBytcJFiq` serves both existing domains as a private-beta preview.

See [release receipt](docs/evidence/2026-11-10-private-beta-release.json), [updated readiness registry](docs/launch-readiness.json) and [regenerated assessment](ASSESSMENT_REPORT.md). This is the post-release operational record. It is kept outside the unchanged application release commit so the checked and deployed source tree remains identifiable. Copy relevant new readiness observations forward when starting the next implementation branch; do not merge this archive tree into the application.

The root rollback README and manifest still describe exact pre-release Edge packages. No new migration, provider activation, real customer send/charge, employee access or public launch occurred. Full migration replay, genuine tenant/provider/device acceptance and required-check enforcement remain open. Future store distribution is recorded as deferred; this release does not create paid store accounts.

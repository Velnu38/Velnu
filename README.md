# Finviant private-beta rollback source

This archive preserves the exact ten Edge Function packages retrieved before the authorized candidate release. It is not an application branch and must not be merged or deployed as a frontend. Automatic Vercel deployment is disabled for this archive branch.

Restore only to beta project `xvybcmyoblfgzokaifsx`, using each entry's file names, entrypoint, import map and existing JWT mode from `manifest.json`. Add `shared/font-data.ts` as `font-data.ts` to each renderer package and verify its SHA256. The old fin-workflow package uses its seven original files. Supabase service version numbers increase when restoring; old version numbers are evidence, not restore arguments.

The preceding frontend is `dpl_2ZZ8fPGmhCg8af9K3b94NzUzSNkb` at `6cacfe7cfc1f9b02c3eec2a9d9ed1e53e78504b1`. Restore both existing domain aliases only if rollback is needed. No schema migration belongs to this release. Do not remove already-applied execution SQL, business records or issued PDF objects. Preserve provider activation, beta-recipient and environment settings.

This is application source recovery, not credentials, customer data, storage backup or proof of a full restore drill.

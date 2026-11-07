import {test} from 'node:test'
// The handler's existing security suite uses only Deno.test; run it on Node too.
;(globalThis as any).Deno={test}
await import('../../supabase/functions/transcribe-voice/index_test.ts')

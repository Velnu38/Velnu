import {squarePaymentsHandler} from './handler.ts'
import {deps} from './runtime.ts'
// OAuth callback and scoped customer links are public. Each protected POST
// verifies a live Supabase user; no browser-supplied actor ID is accepted.
Deno.serve(squarePaymentsHandler(deps))

import { documentEmailHandler } from '../_shared/documentEmail.ts'
Deno.serve(documentEmailHandler(false))

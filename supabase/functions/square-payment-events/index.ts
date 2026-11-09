import {squareEventsHandler} from './handler.ts'
import {deps,webhook} from '../square-payments/runtime.ts'
// Square authenticates the exact notification URL and raw request body.
Deno.serve(squareEventsHandler(deps,webhook))

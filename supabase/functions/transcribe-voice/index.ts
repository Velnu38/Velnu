import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { transcribeVoiceHandler } from "./handler.ts";

Deno.serve(transcribeVoiceHandler);

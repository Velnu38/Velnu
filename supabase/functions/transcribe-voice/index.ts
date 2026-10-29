import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { createTranscribeVoiceHandler } from "./handler.ts";

Deno.serve(
  createTranscribeVoiceHandler({
    createClient,
    env: (key) => Deno.env.get(key),
  }),
);

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { providerJson, ProviderRequestError } from "../_shared/providerRequest.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const jsonHeaders = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
};
const respond = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: jsonHeaders });

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const allowedExtensions = /\.(webm|mp3|mp4|mpeg|mpga|m4a|ogg|wav|flac)$/i;
const allowedMime = /^(audio\/(webm|mpeg|mp4|x-m4a|m4a|wav|x-wav|ogg|flac)|video\/mp4)(;|$)/;
const allowedModels = new Set(["gpt-4o-transcribe", "gpt-4o-mini-transcribe"]);
const model = allowedModels.has(Deno.env.get("OPENAI_TRANSCRIPTION_MODEL") ?? "")
  ? Deno.env.get("OPENAI_TRANSCRIPTION_MODEL")!
  : "gpt-4o-transcribe";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: jsonHeaders });
  if (req.method !== "POST") return respond(405, { error: "Method not allowed" });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return respond(401, { error: "Sign in to use transcription." });

    const url = Deno.env.get("SUPABASE_URL");
    const legacyKey = Deno.env.get("SUPABASE_ANON_KEY");
    const publicKey = legacyKey || JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") || "{}").default;
    if (!url || !publicKey) return respond(503, { error: "Supabase authentication is not configured." });
    const db = createClient(url, publicKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authData, error: authError } = await db.auth.getUser();
    if (authError || !authData.user) return respond(401, { error: "Your session expired. Sign in again." });

    const contentType = req.headers.get("content-type") || "";
    const isJson = contentType.includes("application/json");
    const body: any = isJson ? await req.json() : await req.formData();
    const businessId = String(isJson ? body?.business_id : body.get("business_id") || "");
    if (!uuid.test(businessId)) return respond(400, { error: "A valid business is required." });

    const { data: membership, error: memberError } = await db
      .from("business_members")
      .select("business_id")
      .eq("business_id", businessId)
      .eq("user_id", authData.user.id)
      .maybeSingle();
    if (memberError || !membership) return respond(403, { error: "No access to this business." });

    // Plan selection and add-on interests are NOT paid entitlements. Verify backend
    // entitlements before exposing a billable transcription endpoint or key status.
    const { data: usage, error: usagePlanError } = await db.rpc("get_plan_usage", { target_business_id: businessId });
    if (usagePlanError || !usage) return respond(503, { error: "Could not verify voice service permissions." });
    if (usage.plan !== "pro" || Number(usage.voice_limit ?? 0) <= 0) {
      if (isJson && body?.action === "status") return respond(200, {
        configured: false, model: null, plan_restricted: true,
      });
      return respond(403, { code: "paid_plan_required",
        error: "Cloud AI transcription is not included in Free. It requires an activated paid plan." });
    }

    const apiKey = Deno.env.get("OPENAI_API_KEY")?.trim() || "";
    if (isJson) {
      if (body?.action !== "status") return respond(400, { error: "Unknown action." });
      // Do not return, log, or expose the API credential. The status is tenant-authenticated.
      return respond(200, { configured: apiKey.startsWith("sk-"), model: apiKey ? model : null });
    }
    if (!apiKey.startsWith("sk-")) {
      return respond(503, {
        code: "transcription_not_configured",
        error: "Cloud transcription is not enabled yet. Use the keyboard microphone until the administrator enables OpenAI.",
      });
    }

    const audio = body.get("audio");
    if (!(audio instanceof File)) return respond(400, { error: "No audio recording was attached." });
    if (audio.size < 128) return respond(422, { error: "The recording is empty. Speak after tapping the microphone." });
    if (audio.size > 10 * 1024 * 1024) return respond(413, { error: "Recording is too large. Try a shorter voice command." });

    const audioName = String(audio.name || "finviant.webm");
    const audioMime = String(audio.type || "").toLowerCase();
    if (!allowedExtensions.test(audioName) || (audioMime && !allowedMime.test(audioMime))) {
      return respond(415, { error: "Unsupported audio format. Try recording again." });
    }

    const duration = body.get("duration_seconds");
    const seconds = duration === null || String(duration) === "" ? null : Number(duration);
    if (seconds !== null && (!Number.isFinite(seconds) || seconds <= 0 || seconds > 120)) {
      return respond(400, { error: "Recordings must be 2 minutes or shorter." });
    }

    // Failed and uncertain provider attempts remain counted; row locking prevents overshoot.
    const { error: budgetError } = await db.rpc("reserve_ai_provider_attempt", {
      p_business_id: businessId, p_kind: "transcription",
    });
    if (budgetError) return respond(budgetError.code === "42501" ? 403 : budgetError.code === "P0001" ? 429 : 503, {
      error: "Voice attempt allowance could not be reserved. No provider call was made.",
    });

    const prompt = String(body.get("prompt") || "").slice(0, 300);
    const upload = new FormData();
    upload.append("file", audio, audioName);
    upload.append("model", model);
    upload.append("response_format", "json");
    if (prompt) upload.append("prompt", prompt);

    let result: Record<string, unknown>;
    try {
      result = await providerJson("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST", headers: { Authorization: "Bearer " + apiKey }, body: upload,
      }, { timeoutMs: 60000, maxBytes: 262144 });
    } catch (err) {
      const status = err instanceof ProviderRequestError && err.code === "timeout" ? 504
        : err instanceof ProviderRequestError && err.status === 429 ? 429 : 502;
      return respond(status, { error: "Speech processing could not be confirmed. No business record was changed. You can use typed input instead.", code: "voice_provider_unavailable" });
    }
    const transcript = typeof result.text === "string" ? result.text.trim() : "";
    if (!transcript || transcript.length > 6000) return respond(422, { error: "No usable short command was detected. Please type or record a shorter request." });

    // The browser role intentionally has SELECT-only rights on this table.
    // Never grant client-side INSERT: it would allow callers to forge AI transcripts.
    // Persist only after verified authentication, tenant access, quota reservation,
    // and a valid OpenAI response using a separate server-only client.
    const serviceSecret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim()
      || JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}").default;
    if (!serviceSecret) {
      console.error("Transcription storage unavailable: service credential missing");
      return respond(503, { error: "Speech was recognized but secure storage is temporarily unavailable. Please try again later." });
    }
    const admin = createClient(url, serviceSecret, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: saved, error: saveError } = await admin.from("voice_transcriptions").insert({
      business_id: businessId,
      user_id: authData.user.id,
      provider: "openai",
      model,
      transcript,
      duration_seconds: seconds,
    }).select("id").single();
    if (saveError || !saved?.id) {
      console.error("Failed to save transcription", saveError?.code || "missing_id");
      return respond(503, { error: "Speech was recognized but could not be saved securely. Nothing was changed. Please try again later." });
    }
    return respond(200, {
      transcript,
      transcription_id: saved.id,
    });
  } catch (error) {
    console.error("Transcription handler failed", error instanceof Error ? error.name : "unknown");
    return respond(500, { error: "Transcription encountered an unexpected problem." });
  }
});

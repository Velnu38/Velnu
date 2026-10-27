import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

    const audioName = String(audio.name || "velnu.webm");
    const audioMime = String(audio.type || "").toLowerCase();
    if (!allowedExtensions.test(audioName) || (audioMime && !allowedMime.test(audioMime))) {
      return respond(415, { error: "Unsupported audio format. Try recording again." });
    }

    const duration = body.get("duration_seconds");
    const seconds = duration === null || String(duration) === "" ? null : Number(duration);
    if (seconds !== null && (!Number.isFinite(seconds) || seconds <= 0 || seconds > 120)) {
      return respond(400, { error: "Recordings must be 2 minutes or shorter." });
    }

    // Basic per-user spending guard for initial testing. A stricter provider-side
    // limit and concurrency-safe budget enforcement are required before public launch.
    const { count, error: usageError } = await db.from("voice_transcriptions")
      .select("id", { count: "exact", head: true })
      .eq("business_id", businessId)
      .eq("user_id", authData.user.id)
      .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
    if (usageError) return respond(503, { error: "Unable to check transcription usage; try again." });
    if ((count ?? 0) >= 120) return respond(429, { error: "Daily voice transcription limit reached." });

    const prompt = String(body.get("prompt") || "").slice(0, 300);
    const upload = new FormData();
    upload.append("file", audio, audioName);
    upload.append("model", model);
    upload.append("response_format", "json");
    if (prompt) upload.append("prompt", prompt);

    let response: Response;
    try {
      response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: "Bearer " + apiKey },
        body: upload,
        signal: AbortSignal.timeout(60000),
      });
    } catch {
      return respond(504, { error: "Transcription timed out. Try a shorter recording." });
    }
    if (!response.ok) {
      // Avoid logging the user's audio or transcription; only status and category.
      console.error("Transcription provider request failed", response.status);
      const error = response.status === 401
        ? "The OpenAI API key was rejected. Check the key in Supabase Secrets."
        : response.status === 429
          ? "The transcription service is busy or out of credits. Check API billing and try again."
          : "The transcription service could not process this recording. Try again.";
      return respond(response.status === 429 ? 429 : 502, { error });
    }

    const result = await response.json();
    const transcript = String(result?.text ?? "").trim();
    if (!transcript) return respond(422, { error: "No speech detected. Speak clearly and try again." });

    const { data: saved, error: saveError } = await db.from("voice_transcriptions").insert({
      business_id: businessId,
      user_id: authData.user.id,
      provider: "openai",
      model,
      transcript,
      duration_seconds: seconds,
    }).select("id").single();
    if (saveError) {
      console.error("Failed to save transcription", saveError.code || "unknown");
      return respond(500, { error: "Speech was transcribed but could not be saved securely." });
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

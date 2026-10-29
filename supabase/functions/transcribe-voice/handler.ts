import {
  providerJson,
  ProviderRequestError,
} from "../_shared/providerRequest.ts";

const jsonHeaders = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
};
const respond = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: jsonHeaders });

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const allowedExtensions = /\.(webm|mp3|mp4|mpeg|mpga|m4a|ogg|wav|flac)$/i;
const allowedMime =
  /^(audio\/(webm|mpeg|mp4|x-m4a|m4a|wav|x-wav|ogg|flac)|video\/mp4)(;|$)/;
const allowedModels = new Set(["gpt-4o-transcribe", "gpt-4o-mini-transcribe"]);
export type VoiceDependencies = {
  createClient: (url: string, key: string, options: any) => any;
  env: (key: string) => string | undefined;
  provider?: typeof providerJson;
  bodyTimeoutMs?: number;
  databaseTimeoutMs?: number;
  fetcher?: typeof fetch;
};
function configuredKey(
  env: VoiceDependencies["env"],
  direct: string,
  collection: string,
) {
  const value = env(direct)?.trim();
  if (value) return value;
  try {
    const candidate = JSON.parse(env(collection) || "{}").default;
    return typeof candidate === "string" ? candidate.trim() : "";
  } catch {
    return "";
  }
}
async function boundedBody(
  req: Request,
  limit: number,
  timeoutMs: number,
): Promise<Uint8Array> {
  const size = req.headers.get("content-length");
  if (size && (!/^\d+$/.test(size) || Number(size) > limit)) {
    throw new Error("BODY_TOO_LARGE");
  }
  const reader = req.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let length = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error("BODY_TIMEOUT"));
      void reader.cancel().catch(() => {});
    }, timeoutMs);
  });
  try {
    while (true) {
      const part = await Promise.race([reader.read(), deadline]);
      if (part.done) break;
      length += part.value.byteLength;
      if (length > limit) {
        await reader.cancel();
        throw new Error("BODY_TOO_LARGE");
      }
      chunks.push(part.value);
    }
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    try {
      reader.releaseLock();
    } catch { /* Cancellation may still be settling. */ }
  }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}
export function createTranscribeVoiceHandler(deps: VoiceDependencies) {
  const { createClient, env } = deps;
  const callProvider = deps.provider ?? providerJson;
  const databaseFetch: typeof fetch = (resource, init) =>
    (deps.fetcher ?? fetch)(resource, {
      ...init,
      signal: init?.signal
        ? AbortSignal.any([
          init.signal,
          AbortSignal.timeout(deps.databaseTimeoutMs ?? 10000),
        ])
        : AbortSignal.timeout(deps.databaseTimeoutMs ?? 10000),
    });
  const requestedModel = env("OPENAI_TRANSCRIPTION_MODEL") ?? "";
  const model = allowedModels.has(requestedModel)
    ? requestedModel
    : "gpt-4o-transcribe";
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: jsonHeaders });
    }
    if (req.method !== "POST") {
      return respond(405, { error: "Method not allowed" });
    }

    try {
      const authHeader = req.headers.get("Authorization") ?? "";
      if (!authHeader.startsWith("Bearer ")) {
        return respond(401, { error: "Sign in to use transcription." });
      }

      const url = env("SUPABASE_URL");
      const publicKey = configuredKey(
        env,
        "SUPABASE_ANON_KEY",
        "SUPABASE_PUBLISHABLE_KEYS",
      );
      if (!url || !publicKey) {
        return respond(503, {
          error: "Supabase authentication is not configured.",
        });
      }
      const db = createClient(url, publicKey, {
        global: {
          headers: { Authorization: authHeader },
          fetch: databaseFetch,
        },
        auth: { persistSession: false, autoRefreshToken: false },
      });
      let identity;
      try {
        identity = await db.auth.getUser();
      } catch {
        return respond(503, {
          error: "Session verification is temporarily unavailable.",
        });
      }
      const { data: authData, error: authError } = identity;
      if (authError || !uuid.test(authData?.user?.id ?? "")) {
        return respond(401, { error: "Your session expired. Sign in again." });
      }

      const contentType = req.headers.get("content-type") || "";
      const isJson =
        contentType.split(";")[0].trim().toLowerCase() === "application/json";
      if (
        !isJson && !contentType.toLowerCase().startsWith("multipart/form-data;")
      ) {
        return respond(415, {
          error: "Use a JSON status request or an audio upload.",
        });
      }
      let body: any;
      try {
        const bytes = await boundedBody(
          req,
          isJson ? 8192 : 10 * 1024 * 1024 + 65536,
          deps.bodyTimeoutMs ?? 10000,
        );
        body = isJson
          ? JSON.parse(new TextDecoder().decode(bytes))
          : await new Response(bytes.slice().buffer, {
            headers: { "content-type": contentType },
          }).formData();
        if (
          isJson && (!body || typeof body !== "object" || Array.isArray(body))
        ) return respond(400, { error: "Invalid status request." });
      } catch (error) {
        return respond(
          error instanceof Error && error.message === "BODY_TIMEOUT"
            ? 408
            : error instanceof Error && error.message === "BODY_TOO_LARGE"
            ? 413
            : 400,
          { error: "Invalid, stalled or oversized request body." },
        );
      }
      const businessId = isJson ? body?.business_id : body.get("business_id");
      if (typeof businessId !== "string" || !uuid.test(businessId)) {
        return respond(400, { error: "A valid business is required." });
      }

      const { data: membership, error: memberError } = await db
        .from("business_members")
        .select("business_id")
        .eq("business_id", businessId)
        .eq("user_id", authData.user.id)
        .maybeSingle();
      if (memberError || !membership || membership.business_id !== businessId) {
        return respond(403, { error: "No access to this business." });
      }

      // Plan selection and add-on interests are NOT paid entitlements. Verify backend
      // entitlements before exposing a billable transcription endpoint or key status.
      const { data: usage, error: usagePlanError } = await db.rpc(
        "get_plan_usage",
        { target_business_id: businessId },
      );
      if (usagePlanError || !usage) {
        return respond(503, {
          error: "Could not verify voice service permissions.",
        });
      }
      const voiceLimit = typeof usage.voice_limit === "number" ||
          (typeof usage.voice_limit === "string" &&
            /^\d+$/.test(usage.voice_limit))
        ? Number(usage.voice_limit)
        : NaN;
      if (
        usage.plan !== "pro" || !Number.isSafeInteger(voiceLimit) ||
        voiceLimit <= 0
      ) {
        if (isJson && body?.action === "status") {
          return respond(200, {
            configured: false,
            model: null,
            plan_restricted: true,
          });
        }
        return respond(403, {
          code: "paid_plan_required",
          error:
            "Cloud AI transcription is not included in Free. It requires an activated paid plan.",
        });
      }

      const apiKey = env("OPENAI_API_KEY")?.trim() || "";
      const serviceSecret = configuredKey(
        env,
        "SUPABASE_SERVICE_ROLE_KEY",
        "SUPABASE_SECRET_KEYS",
      );
      if (isJson) {
        if (body?.action !== "status") {
          return respond(400, { error: "Unknown action." });
        }
        // Do not return, log, or expose the API credential. The status is tenant-authenticated.
        return respond(200, {
          configured: apiKey.startsWith("sk-") && !!serviceSecret,
          model: apiKey.startsWith("sk-") && serviceSecret ? model : null,
        });
      }
      if (!apiKey.startsWith("sk-")) {
        return respond(503, {
          code: "transcription_not_configured",
          error:
            "Cloud transcription is not enabled yet. Use the keyboard microphone until the administrator enables OpenAI.",
        });
      }

      if (!serviceSecret) {
        return respond(503, {
          code: "voice_storage_unavailable",
          error:
            "Secure transcription storage is not configured. No provider call was made.",
        });
      }

      const audio = body.get("audio");
      if (!(audio instanceof File)) {
        return respond(400, { error: "No audio recording was attached." });
      }
      if (audio.size < 128) {
        return respond(422, {
          error: "The recording is empty. Speak after tapping the microphone.",
        });
      }
      if (audio.size > 10 * 1024 * 1024) {
        return respond(413, {
          error: "Recording is too large. Try a shorter voice command.",
        });
      }

      const audioName = String(audio.name || "finviant.webm");
      const audioMime = String(audio.type || "").toLowerCase();
      if (
        !allowedExtensions.test(audioName) ||
        (audioMime && !allowedMime.test(audioMime))
      ) {
        return respond(415, {
          error: "Unsupported audio format. Try recording again.",
        });
      }

      const duration = body.get("duration_seconds");
      const seconds = duration === null || String(duration) === ""
        ? null
        : Number(duration);
      if (
        seconds !== null &&
        (!Number.isFinite(seconds) || seconds <= 0 || seconds > 120)
      ) {
        return respond(400, {
          error: "Recordings must be 2 minutes or shorter.",
        });
      }

      // Failed and uncertain provider attempts remain counted; row locking prevents overshoot.
      const { data: reservation, error: budgetError } = await db.rpc(
        "reserve_ai_provider_attempt",
        {
          p_business_id: businessId,
          p_kind: "transcription",
        },
      );
      if (budgetError || reservation?.reserved !== true) {
        return respond(
          budgetError?.code === "42501"
            ? 403
            : budgetError?.code === "P0001"
            ? 429
            : 503,
          {
            error:
              "Voice attempt allowance could not be reserved. No provider call was made.",
          },
        );
      }

      const prompt = String(body.get("prompt") || "").slice(0, 300);
      const upload = new FormData();
      upload.append("file", audio, audioName);
      upload.append("model", model);
      upload.append("response_format", "json");
      if (prompt) upload.append("prompt", prompt);

      let result: Record<string, unknown>;
      try {
        result = await callProvider(
          "https://api.openai.com/v1/audio/transcriptions",
          {
            method: "POST",
            headers: { Authorization: "Bearer " + apiKey },
            body: upload,
          },
          { timeoutMs: 60000, maxBytes: 262144 },
        );
      } catch (err) {
        const status =
          err instanceof ProviderRequestError && err.code === "timeout"
            ? 504
            : err instanceof ProviderRequestError && err.status === 429
            ? 429
            : 502;
        return respond(status, {
          error:
            "Speech processing could not be confirmed. No business record was changed. You can use typed input instead.",
          code: "voice_provider_unavailable",
        });
      }
      const transcript = typeof result.text === "string"
        ? result.text.trim()
        : "";
      if (!transcript || transcript.length > 6000) {
        return respond(422, {
          error:
            "No usable short command was detected. Please type or record a shorter request.",
        });
      }

      // The browser role intentionally has SELECT-only rights on this table.
      // Never grant client-side INSERT: it would allow callers to forge AI transcripts.
      // Persist only after verified authentication, tenant access, quota reservation,
      // and a valid OpenAI response using a separate server-only client.
      let saved: { id?: string } | null = null;
      let saveFailed = false;
      try {
        const admin = createClient(url, serviceSecret, {
          global: { fetch: databaseFetch },
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const result = await admin.from("voice_transcriptions").insert({
          business_id: businessId,
          user_id: authData.user.id,
          provider: "openai",
          model,
          transcript,
          duration_seconds: seconds,
        }).select("id").single();
        saved = result.data;
        saveFailed = !!result.error;
      } catch {
        saveFailed = true;
      }
      if (saveFailed || !saved?.id) {
        console.error("Transcription storage outcome unconfirmed");
        return respond(503, {
          code: "voice_storage_unconfirmed",
          error:
            "Transcript storage could not be confirmed. Check recent voice activity before retrying to avoid another provider charge; typed input remains available.",
        });
      }
      return respond(200, {
        transcript,
        transcription_id: saved.id,
      });
    } catch (error) {
      console.error(
        "Transcription handler failed",
        error instanceof Error ? error.name : "unknown",
      );
      return respond(500, {
        error: "Transcription encountered an unexpected problem.",
      });
    }
  };
}

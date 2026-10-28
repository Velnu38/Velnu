import {
  providerJson,
  ProviderRequestError,
} from "../_shared/providerRequest.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

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
const maxAudioBytes = 10 * 1024 * 1024;

function credential(single: string, collection: string): string | undefined {
  const value = Deno.env.get(single)?.trim();
  if (value) return value;
  try {
    const fallback = JSON.parse(Deno.env.get(collection) || "{}").default;
    return typeof fallback === "string"
      ? fallback.trim() || undefined
      : undefined;
  } catch {
    return undefined;
  }
}

class InputError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

// Bound bytes while reading, before multipart parsing allocates complete Files.
// Content-Length is only an early rejection; chunked/forged lengths are bounded too.
async function readBody(
  req: Request,
  maxBytes: number,
): Promise<Uint8Array<ArrayBuffer>> {
  if (Number(req.headers.get("content-length") || 0) > maxBytes) {
    void req.body?.cancel().catch(() => {});
    throw new InputError(
      413,
      "Recording or request is too large. Try a shorter voice command.",
    );
  }
  if (!req.body) throw new InputError(400, "No request body was attached.");
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > maxBytes) {
            throw new InputError(
              413,
              "Recording or request is too large. Try a shorter voice command.",
            );
          }
          chunks.push(value);
        }
        const result = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
          result.set(chunk, offset);
          offset += chunk.byteLength;
        }
        return result;
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new InputError(408, "Recording upload timed out. Try again."),
            ),
          15000,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    void reader.cancel().catch(() => {});
    chunks.length = 0;
  }
}

export function createTranscribeVoiceHandler(
  provider: typeof providerJson = providerJson,
) {
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

      const url = Deno.env.get("SUPABASE_URL");
      const publicKey = credential(
        "SUPABASE_ANON_KEY",
        "SUPABASE_PUBLISHABLE_KEYS",
      );
      if (!url || !publicKey) {
        return respond(503, {
          error: "Supabase authentication is not configured.",
        });
      }
      const db = createClient(url, publicKey, {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data: authData, error: authError } = await db.auth.getUser();
      if (authError || !authData.user) {
        return respond(401, { error: "Your session expired. Sign in again." });
      }

      const contentType = req.headers.get("content-type") || "";
      const mediaType = contentType.split(";")[0].trim().toLowerCase();
      const isJson = mediaType === "application/json";
      if (!isJson && mediaType !== "multipart/form-data") {
        return respond(415, {
          error: "Use JSON status or a multipart audio upload.",
        });
      }
      let fields: Record<string, unknown> = {};
      let form: FormData | undefined;
      try {
        const bytes = await readBody(
          req,
          isJson ? 4096 : maxAudioBytes + 65536,
        );
        if (isJson) {
          const parsed: unknown = JSON.parse(
            new TextDecoder("utf-8", { fatal: true }).decode(bytes),
          );
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw new InputError(400, "Invalid status request.");
          }
          fields = parsed as Record<string, unknown>;
        } else {
          form = await new Response(bytes, {
            headers: { "content-type": contentType },
          }).formData();
          for (
            const key of ["business_id", "audio", "duration_seconds", "prompt"]
          ) {
            if (form.getAll(key).length > 1) {
              throw new InputError(
                400,
                "Duplicate request fields are not supported.",
              );
            }
          }
        }
      } catch (error) {
        return respond(error instanceof InputError ? error.status : 400, {
          error: error instanceof InputError
            ? error.message
            : "Invalid recording or status request.",
        });
      }
      const businessId = isJson ? fields.business_id : form!.get("business_id");
      if (typeof businessId !== "string") {
        return respond(400, { error: "A valid business is required." });
      }
      if (!uuid.test(businessId)) {
        return respond(400, { error: "A valid business is required." });
      }

      const { data: membership, error: memberError } = await db
        .from("business_members")
        .select("business_id")
        .eq("business_id", businessId)
        .eq("user_id", authData.user.id)
        .maybeSingle();
      if (memberError || !membership) {
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
      const voiceLimit = Number(usage.voice_limit ?? 0);
      if (
        usage.plan !== "pro" || !Number.isSafeInteger(voiceLimit) ||
        voiceLimit <= 0
      ) {
        if (isJson && fields.action === "status") {
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

      const apiKey = Deno.env.get("OPENAI_API_KEY")?.trim() || "";
      const serviceSecret = credential(
        "SUPABASE_SERVICE_ROLE_KEY",
        "SUPABASE_SECRET_KEYS",
      );
      const requestedModel = Deno.env.get("OPENAI_TRANSCRIPTION_MODEL") ?? "";
      const model = allowedModels.has(requestedModel)
        ? requestedModel
        : "gpt-4o-transcribe";
      if (isJson) {
        if (fields.action !== "status") {
          return respond(400, { error: "Unknown action." });
        }
        // Do not return, log, or expose the API credential. The status is tenant-authenticated.
        const configured = apiKey.startsWith("sk-") && !!serviceSecret;
        return respond(200, { configured, model: configured ? model : null });
      }
      if (!apiKey.startsWith("sk-")) {
        return respond(503, {
          code: "transcription_not_configured",
          error:
            "Cloud transcription is not enabled yet. Use the keyboard microphone until the administrator enables OpenAI.",
        });
      }

      // Fail before quota reservation or a billable call if persistence cannot work.
      if (!serviceSecret) {
        return respond(503, {
          error:
            "Secure transcription storage is temporarily unavailable. Please try again later.",
        });
      }

      const audio = form!.get("audio");
      if (!(audio instanceof File)) {
        return respond(400, { error: "No audio recording was attached." });
      }
      if (audio.size < 128) {
        return respond(422, {
          error: "The recording is empty. Speak after tapping the microphone.",
        });
      }
      if (audio.size > maxAudioBytes) {
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

      const duration = form!.get("duration_seconds");
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
      const { data: budget, error: budgetError } = await db.rpc(
        "reserve_ai_provider_attempt",
        {
          p_business_id: businessId,
          p_kind: "transcription",
        },
      );
      if (budgetError || budget?.reserved !== true) {
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

      const prompt = String(form!.get("prompt") || "").slice(0, 300);
      const upload = new FormData();
      upload.append("file", audio, audioName);
      upload.append("model", model);
      upload.append("response_format", "json");
      if (prompt) upload.append("prompt", prompt);

      let result: Record<string, unknown>;
      try {
        result = await provider(
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
      const admin = createClient(url, serviceSecret, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data: saved, error: saveError } = await admin.from(
        "voice_transcriptions",
      ).insert({
        business_id: businessId,
        user_id: authData.user.id,
        provider: "openai",
        model,
        transcript,
        duration_seconds: seconds,
      }).select("id").single();
      if (saveError || !saved?.id) {
        console.error(
          "Failed to save transcription",
          saveError?.code || "missing_id",
        );
        return respond(503, {
          error:
            "Speech was recognized but could not be saved securely. Nothing was changed. Please try again later.",
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

export const transcribeVoiceHandler = createTranscribeVoiceHandler();

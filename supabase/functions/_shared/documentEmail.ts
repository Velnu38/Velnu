import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { dispatchQueuedEmail } from "./emailDispatch.ts";
import { readLimitedRequest } from "./signedEvents.ts";
import { resolveAppEnvironment } from "./appEnvironment.ts";
import { emailDeliveryMode } from "./emailRelease.ts";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function documentEmailHandler(
  invoiceOnly: boolean,
  reminder = false,
  businessCard = false,
) {
  return async (req: Request): Promise<Response> => {
    const trace = crypto.randomUUID(),
      origin = req.headers.get("origin") || "";
    const environment = resolveAppEnvironment(
      Deno.env.get("SUPABASE_URL"),
      Deno.env.get("FINVIANT_APP_BASE_URL"),
    );
    const headers = {
      "content-type": "application/json",
      "cache-control": "no-store",
      "x-request-id": trace,
      ...(environment?.origins.includes(origin)
        ? { "access-control-allow-origin": origin }
        : {}),
      "access-control-allow-headers":
        "authorization,apikey,x-client-info,content-type",
      "access-control-allow-methods": "POST, OPTIONS",
      vary: "Origin",
    };
    const respond = (status: number, body: Record<string, unknown>) =>
      new Response(JSON.stringify({ ...body, request_id: trace }), {
        status,
        headers,
      });
    if (!environment)
      return respond(503, {
        error: "Application environment is not configured.",
      });
    if (origin && !environment.origins.includes(origin))
      return respond(403, { error: "This app address is not authorized." });
    if (req.method === "OPTIONS") return new Response("ok", { headers });
    if (req.method !== "POST")
      return respond(405, { error: "Method not allowed." });
    const auth = req.headers.get("authorization") || "";
    if (!auth.startsWith("Bearer "))
      return respond(401, { error: "Sign in to send a document." });
    try {
      const url = Deno.env.get("SUPABASE_URL"),
        anon = Deno.env.get("SUPABASE_ANON_KEY"),
        service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (!url || !anon || !service)
        return respond(503, { error: "Email service is not configured." });
      const caller = createClient(url, anon, {
        global: { headers: { Authorization: auth } },
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data: identity, error: authError } = await caller.auth.getUser();
      if (authError || !identity.user)
        return respond(401, { error: "Session expired. Sign in again." });
      const resend = Deno.env.get("RESEND_API_KEY"),
        webhook = Deno.env.get("RESEND_WEBHOOK_SECRET");
      if (emailDeliveryMode() === "disabled" || !resend || !webhook)
        return respond(503, {
          error:
            "Customer email is awaiting verified delivery configuration. No message was queued or sent.",
          code: "email_not_enabled",
        });
      let input: Record<string, unknown>;
      try {
        input = JSON.parse(await readLimitedRequest(req, 16384));
      } catch {
        return respond(400, { error: "Invalid or oversized request." });
      }
      if (!input || typeof input !== "object" || Array.isArray(input))
        return respond(400, { error: "Invalid request." });
      const business = String(input.business_id || ""),
        document = String(
          (invoiceOnly ? input.invoice_id : input.document_id) || "",
        ),
        operation = String(input.request_id || "");
      const kind = invoiceOnly ? "invoice" : String(input.document_type || "");
      if (
        ![business, document, operation].every((v) => UUID.test(v)) ||
        (!invoiceOnly &&
          !(businessCard
            ? kind === "business_card"
            : ["estimate", "change_order"].includes(kind)))
      )
        return respond(400, {
          error:
            "A valid business, document and persistent send identifier are required.",
        });
      if (
        input.expected_recipient !== undefined &&
        (typeof input.expected_recipient !== "string" ||
          input.expected_recipient.length > 254 ||
          !input.expected_recipient.trim())
      )
        return respond(400, {
          error: "A valid reviewed recipient is required.",
        });
      if (
        input.expected_revision_id !== undefined &&
        (typeof input.expected_revision_id !== "string" ||
          !UUID.test(input.expected_revision_id))
      )
        return respond(400, {
          error: "A valid reviewed document version is required.",
        });
      if (
        businessCard &&
        (document !== business ||
          typeof input.expected_recipient !== "string" ||
          typeof input.expected_revision_id !== "string")
      )
        return respond(400, {
          error: "Review the saved business card and recipient before sending.",
        });
      const admin = createClient(url, service, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const version =
        input.expected_revision_id !== undefined
          ? { p_expected_revision_id: input.expected_revision_id }
          : {};
      const { data: prepared, error: prepError } = await admin
        .rpc(
          businessCard
            ? "prepare_business_card_email"
            : reminder
              ? "prepare_invoice_reminder_email"
              : input.expected_recipient !== undefined
                ? "prepare_review_document_email"
                : "prepare_document_email",
          businessCard
            ? {
                p_actor: identity.user.id,
                p_business: business,
                p_request: operation,
                p_recipient: input.expected_recipient,
                p_expected_revision: input.expected_revision_id,
              }
            : reminder
              ? {
                  p_actor: identity.user.id,
                  p_business: business,
                  p_document: document,
                  p_request: operation,
                  p_review: input.review,
                  ...version,
                }
              : {
                  p_actor: identity.user.id,
                  p_business: business,
                  p_kind: kind,
                  p_document: document,
                  p_request: operation,
                  p_origin: environment.baseUrl,
                  ...(input.expected_recipient !== undefined
                    ? { p_recipient: input.expected_recipient }
                    : {}),
                  ...version,
                },
        )
        .abortSignal(AbortSignal.timeout(5000));
      if (prepError?.message === "DOCUMENT_VERSION_CHANGED")
        return respond(409, {
          error:
            "This document changed after the PDF was reviewed. Reopen its final PDF before sending.",
          code: "document_version_changed",
        });
      if (prepError?.message === "PENDING_DOCUMENT_VERSION_CONFLICT")
        return respond(409, {
          error:
            "An earlier saved send uses a different document version. Check its activity before retrying; do not start another send until its outcome is confirmed.",
          code: "pending_document_version_conflict",
        });
      if (prepError?.message === "BETA_EMAIL_RECIPIENT_NOT_APPROVED")
        return respond(403, {
          error:
            "Private beta email requires an approved test recipient. No email was queued or sent. Review the recipient before trying again.",
          code: "beta_recipient_not_approved",
          beta_send_not_started: true,
        });
      if (businessCard && prepError)
        return respond(prepError.code === "42501" ? 403 : 409, {
          error: prepError.message,
          code: "card_send_not_queued",
        });
      if (prepError || !prepared)
        return respond(prepError?.code === "42501" ? 403 : 409, {
          error:
            prepError?.code === "23514"
              ? reminder
                ? "Invoice, customer, or pending-send details changed. Reload the reminder and check invoice activity before sending."
                : "Customer or pending-send details changed. Open the saved document and review its recipient before sending."
              : "Unable to queue the document. Check account permissions, plan, recipient and document status.",
        });
      const result = await dispatchQueuedEmail(
        admin,
        resend,
        prepared.id,
        trace,
      );
      return respond(result.status, result.body);
    } catch {
      console.error(
        JSON.stringify({
          service: "document-email",
          request_id: trace,
          code: "unexpected",
        }),
      );
      return respond(500, {
        error:
          "The send outcome is not confirmed. Keep the same send identifier when retrying.",
      });
    }
  };
}

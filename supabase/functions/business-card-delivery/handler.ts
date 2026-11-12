import { readLimitedRequest } from '../_shared/signedEvents.ts'
import { burstLimitResponse } from '../_shared/burstLimit.ts'
export type CardDeliveryDependencies = {
  enabled: (channel: string) => boolean;
  origins: string[];
  authorize: (auth: string) => Promise<string | null>;
  prepare: (actor: string, input: any) => Promise<{ data: any; error: any }>;
  email: (id: string) => Promise<{ status: number; body: any; headers?: Record<string,string> }>;
  claim: (id: string) => Promise<any>;
  send: (claim: any) => Promise<{ sid: string }>;
  finish: (
    id: string,
    status: string,
    provider: string | null,
  ) => Promise<unknown>;
};
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
export function businessCardDeliveryHandler(d: CardDeliveryDependencies) {
  return async (req: Request) => {
    const origin = req.headers.get("origin") || "",
      headers = {
        "content-type": "application/json",
        "cache-control": "no-store",
        "access-control-allow-headers":
          "authorization,apikey,x-client-info,content-type",
        "access-control-allow-methods": "POST,OPTIONS",
        vary: "Origin",
        ...(d.origins.includes(origin)
          ? { "access-control-allow-origin": origin }
          : {}),
      };
    const reply = (status: number, body: any) =>
      new Response(JSON.stringify(body), { status, headers });
    if (origin && !d.origins.includes(origin))
      return reply(403, { error: "Unauthorized app address." });
    if (req.method === "OPTIONS") return reply(200, {});
    if (req.method !== "POST")
      return reply(405, { error: "Method not allowed." });
    const auth = req.headers.get("authorization") || "";
    if (!auth.startsWith("Bearer "))
      return reply(401, { error: "Sign in before sending." });
    try {
      const actor = await d.authorize(auth);
      if (!actor) return reply(401, { error: "Sign in again." });
      const raw = await readLimitedRequest(req,4096);
      let input;
      try {
        input = JSON.parse(raw);
      } catch {
        return reply(400, { error: "Invalid request." });
      }
      if (
        !input ||
        !["business_id", "request_id", "revision"].every(
          (k) => typeof input[k] === "string" && uuid.test(input[k]),
        ) ||
        !/^[a-f0-9]{64}$/.test(input.token) ||
        !["email", "sms"].includes(input.channel) ||
        typeof input.recipient !== "string" ||
        input.recipient.length > 254 ||
        (input.customer_id !== null &&
          input.customer_id !== undefined &&
          !uuid.test(input.customer_id))
      )
        return reply(400, { error: "Review the saved card and recipient." });
      if (
        input.channel === "email"
          ? !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(input.recipient)
          : !/^\+1\d{10}$/.test(input.recipient) || input.consent !== true
      )
        return reply(400, {
          error: "Review the recipient and confirm permission for texts.",
        });
      if (!d.enabled(input.channel))
        return reply(503, {
          error:
            "Finviant " +
            (input.channel === "sms" ? "text" : "email") +
            " sending is awaiting provider activation. No new send was started.",
        });
      const { data: prepared, error } = await d.prepare(actor, input);
      const limited=burstLimitResponse(error,headers);if(limited)return limited
      if (error || !prepared)
        return reply(error?.code === "42501" ? 403 : 409, {
          error:
            error?.message === "BETA_EMAIL_RECIPIENT_NOT_APPROVED"
              ? "Private beta email requires an approved test recipient. No email was sent."
              : error?.message || "Unable to prepare this send.",
          not_started: error?.message === "BETA_EMAIL_RECIPIENT_NOT_APPROVED",
        });
      if (input.channel === "email") {
        const result = await d.email(prepared.id);
        return new Response(JSON.stringify({
          ...result.body,
          not_started: result.body.beta_send_not_started === true,
        }),{status:result.status,headers:{...headers,...result.headers}});
      }
      const claim = await d.claim(prepared.id);
      if (["accepted", "delivered"].includes(claim.status))
        return reply(200, {
          status: claim.status,
          recipient: claim.recipient,
          message_id: claim.provider_id,
        });
      if (claim.status !== "claimed")
        return reply(409, {
          error:
            "The text is pending or needs review. Check its activity; it will not be sent again automatically.",
          status: claim.status,
        });
      let result;
      try {
        result = await d.send(claim);
        if (!/^SM[0-9a-f]{32}$/i.test(result.sid))
          throw Error("Invalid provider receipt");
      } catch {
        await d.finish(claim.id, "uncertain", null).catch(() => {});
        return reply(502, {
          error:
            "The text outcome is uncertain. Check its activity; do not start another send.",
          status: "uncertain",
        });
      }
      try {
        await d.finish(claim.id, "accepted", result.sid);
      } catch {
        return reply(200, {
          status: "accepted",
          warning:
            "Provider accepted this text; local reconciliation is pending. Do not resend.",
        });
      }
      return reply(200, { status: "accepted", message_id: result.sid });
    } catch (error) {
      const limited=burstLimitResponse(error,headers);if(limited)return limited
      if(error instanceof Error&&error.message==='REQUEST_TOO_LARGE')return reply(413,{error:'Request too large.'})
      if(error instanceof Error&&error.message==='REQUEST_TIMEOUT')return reply(408,{error:'Request timed out. No new send was started.'})
      return reply(503, {
        error:
          "The send outcome is unconfirmed. Keep this same send and check activity before another attempt.",
      });
    }
  };
}

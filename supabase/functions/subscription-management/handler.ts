import { readLimitedRequest } from "../_shared/signedEvents.ts";
export interface BillingDependencies {
  authorize: (
    authorization: string,
    business: string,
  ) => Promise<{ binding: any; denied: boolean } | null>;
  stripe: (path: string, body?: URLSearchParams, key?: string) => Promise<any>;
  origin: string;
  allowedOrigins: readonly string[];
  livemode: boolean;
}
export function subscriptionHandler(deps: BillingDependencies) {
  return async (req: Request) => {
    const origin = req.headers.get("origin");
    const headers = {
      "content-type": "application/json",
      "cache-control": "no-store",
      "access-control-allow-origin":
        origin && deps.allowedOrigins.includes(origin) ? origin : deps.origin,
      "access-control-allow-headers":
        "authorization,apikey,content-type,x-client-info",
      "access-control-allow-methods": "POST, OPTIONS",
      vary: "Origin",
    };
    const reply = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), { status, headers });
    if (origin && !deps.allowedOrigins.includes(origin))
      return reply(403, { error: "App address not authorized." });
    if (req.method === "OPTIONS") return new Response("ok", { headers });
    if (req.method !== "POST")
      return reply(405, { error: "Method not allowed." });
    try {
      const text = await readLimitedRequest(req, 2048);
      if (text.length > 2048)
        return reply(413, { error: "Request too large." });
      const input = JSON.parse(text);
      if (
        typeof input.business_id !== "string" ||
        !["status", "cancel"].includes(input.action)
      )
        return reply(400, { error: "Invalid subscription request." });
      const caller = await deps.authorize(
        req.headers.get("authorization") || "",
        input.business_id,
      );
      if (!caller)
        return reply(401, { error: "Sign in to manage your subscription." });
      if (caller.denied)
        return reply(403, {
          error: "Only the primary owner can manage the subscription.",
        });
      if (!caller.binding)
        return reply(200, { active: false, status: "none", can_cancel: false });
      const b = caller.binding;
      if (
        b.livemode !== deps.livemode ||
        !/^sub_[A-Za-z0-9]+$/.test(b.stripe_subscription_id)
      )
        return reply(503, { error: "Billing configuration needs review." });
      let sub = await deps.stripe("/subscriptions/" + b.stripe_subscription_id);
      if (sub.customer !== b.stripe_customer_id || sub.livemode !== b.livemode)
        return reply(403, {
          error: "Subscription ownership could not be verified.",
        });
      const canCancel = !["canceled", "incomplete_expired"].includes(
        sub.status,
      );
      if (input.action === "cancel" && canCancel && !sub.cancel_at_period_end)
        sub = await deps.stripe(
          "/subscriptions/" + sub.id,
          new URLSearchParams({ cancel_at_period_end: "true" }),
          "finviant-cancel-" + sub.id,
        );
      const end =
        sub.cancel_at ||
        sub.current_period_end ||
        sub.items?.data?.[0]?.current_period_end;
      // Read directly from Stripe; a local success page never determines paid entitlements.
      return reply(200, {
        active: canCancel,
        status: sub.status,
        cancel_at_period_end: !!sub.cancel_at_period_end,
        ends_at: end ? new Date(end * 1000).toISOString() : null,
        can_cancel: canCancel,
      });
    } catch {
      console.warn(
        JSON.stringify({
          service: "subscription-management",
          event: "provider_unavailable",
        }),
      );
      return reply(503, {
        error:
          "Unable to confirm the subscription status. No cancellation is confirmed; retry or check your billing provider.",
      });
    }
  };
}

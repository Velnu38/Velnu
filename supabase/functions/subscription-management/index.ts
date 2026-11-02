import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { resolveAppEnvironment } from "../_shared/appEnvironment.ts";
import { providerJson } from "../_shared/providerRequest.ts";
import { subscriptionHandler } from "./handler.ts";
const env = resolveAppEnvironment(Deno.env.get("SUPABASE_URL"));
Deno.serve(
  env
    ? subscriptionHandler({
        origin: env.baseUrl,
        allowedOrigins: env.origins,
        livemode: Deno.env.get("FINVIANT_BILLING_LIVE") === "true",
        async authorize(authorization, business) {
          if (!authorization.startsWith("Bearer ")) return null;
          const db = createClient(
            Deno.env.get("SUPABASE_URL")!,
            Deno.env.get("SUPABASE_ANON_KEY")!,
            {
              global: { headers: { Authorization: authorization } },
              auth: { persistSession: false, autoRefreshToken: false },
            },
          );
          const { data, error } = await db.auth.getUser();
          if (error || !data.user) return null;
          const result = await db.rpc("get_billing_binding", {
            p_business: business,
          });
          return { binding: result.data, denied: !!result.error };
        },
        async stripe(path, body, key) {
          const secret = Deno.env.get("STRIPE_BILLING_RESTRICTED_KEY");
          if (!secret) throw new Error("Billing not configured");
          return await providerJson(
            "https://api.stripe.com/v1" + path,
            {
              method: body ? "POST" : "GET",
              headers: {
                Authorization: "Bearer " + secret,
                "Stripe-Version": "2026-10-28.endive",
                ...(body
                  ? {
                      "Content-Type": "application/x-www-form-urlencoded",
                      "Idempotency-Key": key!,
                    }
                  : {}),
              },
              body: body?.toString(),
            },
            { timeoutMs: 15000, maxBytes: 262144 },
          );
        },
      })
    : () =>
        new Response(
          JSON.stringify({ error: "App environment is not configured." }),
          { status: 503, headers: { "content-type": "application/json" } },
        ),
);

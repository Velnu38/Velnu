import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { resolveAppEnvironment } from "../_shared/appEnvironment.ts";
import { providerJson } from "../_shared/providerRequest.ts";
import { teamHandler } from "./handler.ts";
const environment = resolveAppEnvironment(Deno.env.get("SUPABASE_URL"));
Deno.serve(
  environment
    ? teamHandler({
        origin: environment.baseUrl,
        allowedOrigins: environment.origins,
        async authorize(authorization) {
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
          return {
            reserve: async (args) =>
              await db.rpc("reserve_team_invitation", args),
          };
        },
        async send(email, url, name, id) {
          const key = Deno.env.get("RESEND_API_KEY");
          if (!key) return false;
          const result = await providerJson(
            "https://api.resend.com/emails",
            {
              method: "POST",
              headers: {
                Authorization: "Bearer " + key,
                "Content-Type": "application/json",
                "Idempotency-Key": "team-invite-" + id,
              },
              body: JSON.stringify({
                from: "Finviant Office <adminsupport@finviant.com>",
                to: [email],
                subject: "Invitation to join a business on Finviant Office",
                text: `You have been invited to join ${name} on Finviant Office.\n\nSign in or create an account with this email address, then accept your invitation:\n${url}\n\nThe invitation expires in seven days. You do not need to purchase a subscription. If you were not expecting this invitation, you can ignore it.`,
              }),
            },
            { timeoutMs: 15000, maxBytes: 65536 },
          );
          return typeof result.id === "string";
        },
      })
    : () =>
        new Response(
          JSON.stringify({ error: "App environment is not configured." }),
          { status: 503, headers: { "content-type": "application/json" } },
        ),
);

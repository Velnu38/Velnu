import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { businessCardDeliveryHandler } from "./handler.ts";
import { dispatchQueuedEmail } from "../_shared/emailDispatch.ts";
import { emailDeliveryMode } from "../_shared/emailRelease.ts";
import { resolveAppEnvironment } from "../_shared/appEnvironment.ts";
import { providerJson } from "../_shared/providerRequest.ts";
const env = (k: string) => Deno.env.get(k) || "",
  url = env("SUPABASE_URL"),
  account = env("TWILIO_ACCOUNT_SID"),
  token = env("TWILIO_AUTH_TOKEN"),
  environment = resolveAppEnvironment(url, env("FINVIANT_APP_BASE_URL"));
const admin = createClient(url, env("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false, autoRefreshToken: false },
});
async function rpc(name: string, args: Record<string, unknown>) {
  const r = await admin.rpc(name, args).abortSignal(AbortSignal.timeout(8000));
  if (r.error) throw r.error;
  return r.data;
}
Deno.serve(
  businessCardDeliveryHandler({
    origins: environment?.origins || [],
    enabled: (channel) =>
      !!environment &&
      (channel === "email"
        ? emailDeliveryMode() !== "disabled"
        : env("FINVIANT_CUSTOMER_SMS_ENABLED") === "true" &&
          /^AC[0-9a-f]{32}$/i.test(account) &&
          !!token),
    async authorize(auth) {
      const caller = createClient(url, env("SUPABASE_ANON_KEY"), {
        global: { headers: { Authorization: auth } },
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data, error } = await caller.auth.getUser();
      return error ? null : data.user?.id || null;
    },
    prepare: (actor, i) =>
      admin
        .rpc("prepare_business_card_delivery", {
          p_actor: actor,
          p_business: i.business_id,
          p_request: i.request_id,
          p_revision: i.revision,
          p_token: i.token,
          p_channel: i.channel,
          p_recipient: i.recipient,
          p_customer: i.customer_id || null,
          p_consent: i.consent === true,
        })
        .abortSignal(AbortSignal.timeout(8000)),
    email: (id) =>
      dispatchQueuedEmail(
        admin,
        env("RESEND_API_KEY"),
        id,
        crypto.randomUUID(),
      ),
    claim: (id) => rpc("claim_business_card_sms", { p_request: id }),
    async send(claim) {
      return (await providerJson(
        "https://api.twilio.com/2010-04-01/Accounts/" +
          account +
          "/Messages.json",
        {
          method: "POST",
          headers: {
            Authorization: "Basic " + btoa(account + ":" + token),
            "content-type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            To: claim.recipient,
            From: claim.sender,
            Body: claim.body,
            StatusCallback:
              url + "/functions/v1/managed-sms-events?request_id=" + claim.id,
          }).toString(),
        },
        { timeoutMs: 15000, maxBytes: 65536 },
      )) as { sid: string };
    },
    finish: (id, status, provider) =>
      rpc("finish_managed_sms", {
        p_request: id,
        p_status: status,
        p_provider: provider,
      }),
  }),
);

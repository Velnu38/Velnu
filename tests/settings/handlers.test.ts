import { test } from "node:test";
import assert from "node:assert/strict";
import {
  teamHandler,
  type TeamDependencies,
} from "../../supabase/functions/team-management/handler.ts";
import {
  subscriptionHandler,
  type BillingDependencies,
} from "../../supabase/functions/subscription-management/handler.ts";
import { validPaymentLink, adjustedPrice } from "../../src/lib/paymentLinks.ts";
const origin = "https://finviant.com",
  bid = "11111111-1111-4111-8111-111111111111";
const request = (input: unknown, auth = true) =>
  new Request(origin, {
    method: "POST",
    headers: {
      origin,
      "content-type": "application/json",
      ...(auth ? { authorization: "Bearer token" } : {}),
    },
    body: JSON.stringify(input),
  });
const invitation = {
  business_id: bid,
  email: "employee@example.test",
  role: "office",
  modules: ["billing"],
};
test("invitation endpoint authenticates and respects database denials without sending", async () => {
  let sends = 0;
  const deps: TeamDependencies = {
    origin,
    allowedOrigins: [origin],
    authorize: async () => null,
    send: async () => {
      sends++;
      return true;
    },
  };
  assert.equal(
    (await teamHandler(deps)(request(invitation, false))).status,
    401,
  );
  deps.authorize = async () => ({
    reserve: async () => ({
      data: null,
      error: { code: "42501", message: "Only the primary owner" },
    }),
  });
  assert.equal((await teamHandler(deps)(request(invitation))).status, 403);
  assert.equal(sends, 0);
  assert.equal(
    (await teamHandler(deps)(request({ ...invitation, role: "owner" }))).status,
    400,
  );
});
test("invitation stores only a hash and returns recoverable copy link if delivery is unconfirmed", async () => {
  let saved: any;
  const deps: TeamDependencies = {
    origin,
    allowedOrigins: [origin],
    authorize: async () => ({
      reserve: async (args) => {
        saved = args;
        return {
          data: {
            id: "invite-1",
            email: invitation.email,
            business_name: "Company",
            expires_at: "2026-11-09",
          },
          error: null,
        };
      },
    }),
    send: async () => false,
  };
  const response = await teamHandler(deps)(request(invitation));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.email_status, "unconfirmed");
  const token = new URL(body.url).searchParams.get("invite")!;
  assert.equal(token.length, 64);
  const hash = Buffer.from(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)),
  ).toString("hex");
  assert.equal(saved.p_hash, hash);
  assert.notEqual(saved.p_hash, token);
  assert.equal(JSON.stringify(saved).includes(token), false);
});
test("subscription owner gate, no-subscription state and customer/mode binding are enforced", async () => {
  let calls = 0;
  const deps: BillingDependencies = {
    origin,
    allowedOrigins: [origin],
    livemode: false,
    authorize: async () => ({ binding: null, denied: true }),
    stripe: async () => {
      calls++;
      return {};
    },
  };
  assert.equal(
    (
      await subscriptionHandler(deps)(
        request({ business_id: bid, action: "cancel" }),
      )
    ).status,
    403,
  );
  deps.authorize = async () => ({ binding: null, denied: false });
  assert.deepEqual(
    await (
      await subscriptionHandler(deps)(
        request({ business_id: bid, action: "cancel" }),
      )
    ).json(),
    { active: false, status: "none", can_cancel: false },
  );
  assert.equal(calls, 0);
  deps.authorize = async () => ({
    binding: {
      stripe_customer_id: "cus_owner",
      stripe_subscription_id: "sub_owner",
      livemode: false,
    },
    denied: false,
  });
  deps.stripe = async () => ({
    id: "sub_owner",
    customer: "cus_other",
    livemode: false,
    status: "active",
  });
  assert.equal(
    (
      await subscriptionHandler(deps)(
        request({ business_id: bid, action: "cancel" }),
      )
    ).status,
    403,
  );
});
test("cancellation requests end-of-period once and reports provider-confirmed status; errors never claim success", async () => {
  const calls: any[] = [];
  const deps: BillingDependencies = {
    origin,
    allowedOrigins: [origin],
    livemode: false,
    authorize: async () => ({
      binding: {
        stripe_customer_id: "cus_owner",
        stripe_subscription_id: "sub_owner",
        livemode: false,
      },
      denied: false,
    }),
    stripe: async (path, body, key) => {
      calls.push({ path, body: body?.toString(), key });
      return {
        id: "sub_owner",
        customer: "cus_owner",
        livemode: false,
        status: "active",
        cancel_at_period_end: !!body,
        cancel_at: 1800000000,
      };
    },
  };
  const response = await subscriptionHandler(deps)(
    request({ business_id: bid, action: "cancel" }),
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).cancel_at_period_end, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].body, "cancel_at_period_end=true");
  deps.stripe = async () => {
    throw new Error("offline");
  };
  assert.equal(
    (
      await subscriptionHandler(deps)(
        request({ business_id: bid, action: "cancel" }),
      )
    ).status,
    503,
  );
});
test("payment links reject lookalike hosts and unsafe protocols; price adjustment keeps cents stable", () => {
  assert.equal(
    validPaymentLink({ provider: "paypal", url: "https://paypal.me/business" }),
    true,
  );
  assert.equal(
    validPaymentLink({
      provider: "cashapp",
      url: "https://cash.app/$Business",
    }),
    true,
  );
  for (const url of [
    "javascript:alert(1)",
    "https://paypal.me.evil.test/pay",
    "https://paypal.me@evil.test/pay",
    "https://paypal.me/pay%0a",
    "http://paypal.me/business",
  ])
    assert.equal(validPaymentLink({ provider: "paypal", url }), false);
  assert.equal(adjustedPrice("100", 3), "103.00");
  assert.equal(adjustedPrice("19.99", 2.9), "20.57");
  assert.throws(() => adjustedPrice("100", -1));
});

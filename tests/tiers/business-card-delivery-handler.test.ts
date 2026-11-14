import test from "node:test";
import assert from "node:assert/strict";
import {
  businessCardDeliveryHandler,
  type CardDeliveryDependencies,
} from "../../supabase/functions/business-card-delivery/handler";
const id = "11111111-1111-4111-8111-111111111111",
  input = {
    business_id: id,
    request_id: id,
    revision: id,
    token: "a".repeat(64),
    channel: "sms",
    recipient: "+17575550123",
    customer_id: null,
    consent: true,
  };
const request = (
  body: any = input,
  origin = "https://finviant.com",
  auth = true,
) =>
  new Request("https://test.invalid", {
    method: "POST",
    headers: {
      origin,
      ...(auth ? { authorization: "Bearer fixture" } : {}),
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
function setup() {
  let prepares = 0,
    sends = 0,
    status = "queued";
  const d: CardDeliveryDependencies = {
    enabled: () => true,
    origins: ["https://finviant.com"],
    authorize: async () => id,
    prepare: async () => {
      prepares++;
      return { data: { id }, error: null };
    },
    email: async () => ({ status: 200, body: { status: "accepted" } }),
    claim: async () =>
      status === "queued"
        ? ((status = "sending"), { id, status: "claimed" })
        : { id, status },
    send: async () => {
      sends++;
      throw Error("timeout");
    },
    finish: async (_id, s) => {
      status = s;
    },
  };
  return {
    d,
    h: businessCardDeliveryHandler(d),
    prepares: () => prepares,
    sends: () => sends,
  };
}
test("new card endpoint rejects unauthenticated, foreign-origin, oversized and malformed requests without provider calls", async () => {
  for (const req of [
    request(input, "https://attacker.test"),
    request(input, undefined, false),
    request({ ...input, token: "bad" }),
    request({ ...input, recipient: "bad" }),
    request({ ...input, consent: false }),
    request({ ...input, padding: "x".repeat(5000) }),
  ]) {
    const a = setup();
    assert.ok((await a.h(req)).status >= 400);
    assert.equal(a.prepares(), 0);
    assert.equal(a.sends(), 0);
  }
});
test("SMS activation fails closed; an uncertain send never calls Twilio twice", async () => {
  const a = setup();
  a.d.enabled = () => false;
  assert.equal((await a.h(request())).status, 503);
  assert.equal(a.prepares(), 0);
  a.d.enabled = () => true;
  assert.equal((await a.h(request())).status, 502);
  assert.equal((await a.h(request())).status, 409);
  assert.equal(a.sends(), 1);
});
test("email uses shared dispatcher and beta rejection provides safe corrective feedback", async () => {
  const a = setup();
  let dispatches = 0;
  a.d.email = async () => {
    dispatches++;
    return { status: 200, body: { status: "accepted", email_id: "fixture" } };
  };
  assert.equal(
    (
      await a.h(
        request({
          ...input,
          channel: "email",
          recipient: "approved@example.test",
        }),
      )
    ).status,
    200,
  );
  assert.equal(dispatches, 1);
  a.d.prepare = async () => ({
    data: null,
    error: { message: "BETA_EMAIL_RECIPIENT_NOT_APPROVED", code: "42501" },
  });
  const denied = await a.h(
    request({ ...input, channel: "email", recipient: "other@example.test" }),
  );
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).not_started, true);
  assert.equal(dispatches, 1);
});

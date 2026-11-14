import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import ts from "typescript";
import { readFile } from "node:fs/promises";
const source = ts
  .transpileModule(
    await readFile("supabase/functions/_shared/documentEmail.ts", "utf8"),
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
      },
    },
  )
  .outputText.replace(/^import .*\n/gm, "")
  .replace(
    "export function documentEmailHandler",
    "function documentEmailHandler",
  );
const B = "11111111-1111-4111-8111-111111111111",
  R = "22222222-2222-4222-8222-222222222222",
  U = "33333333-3333-4333-8333-333333333333";
const input = {
  business_id: B,
  document_id: B,
  document_type: "business_card",
  expected_recipient: "customer@example.test",
  expected_revision_id: R,
  request_id: R,
};
function endpoint({
  authenticated = true,
  mode = "private_beta",
  prepError = null as any,
} = {}) {
  let dispatched = 0;
  const calls: any[] = [],
    context: any = {
      Request,
      Response,
      AbortSignal,
      crypto,
      console: { error() {} },
      Deno: { env: { get: () => "configured" } },
      emailDeliveryMode: () => mode,
      resolveAppEnvironment: () => ({
        origins: ["https://finviant.com"],
        baseUrl: "https://finviant.com",
      }),
      readLimitedRequest: (req: Request) => req.text(),
      createClient: () => ({
        auth: {
          getUser: async () => ({
            data: { user: authenticated ? { id: U } : null },
            error: null,
          }),
        },
        rpc: (name: string, args: any) => {
          calls.push({ name, args });
          return {
            abortSignal: async () => ({
              data: prepError ? null : { id: R },
              error: prepError,
            }),
          };
        },
      }),
      dispatchQueuedEmail: async () => {
        dispatched++;
        return {
          status: 200,
          body: { status: "accepted", email_id: "fixture", send_id: R },
        };
      },
    };
  vm.runInNewContext(source, context);
  const handler = context.documentEmailHandler(false, false, true);
  return {
    calls,
    dispatched: () => dispatched,
    invoke: (body: any = input, auth = true, origin = "https://finviant.com") =>
      handler(
        new Request("https://test.invalid", {
          method: "POST",
          headers: {
            origin,
            ...(auth ? { authorization: "Bearer fixture" } : {}),
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
        }),
      ),
  };
}
test("card endpoint validates session, card scope and frozen revision, using authenticated actor rather than request actor", async () => {
  const e = endpoint();
  assert.equal((await e.invoke({ ...input, p_actor: "forged" })).status, 200);
  assert.deepEqual(JSON.parse(JSON.stringify(e.calls)), [
    {
      name: "prepare_business_card_email",
      args: {
        p_actor: U,
        p_business: B,
        p_request: R,
        p_recipient: "customer@example.test",
        p_expected_revision: R,
      },
    },
  ]);
  assert.equal(e.dispatched(), 1);
  for (const invalid of [
    { ...input, document_id: R },
    { ...input, expected_revision_id: undefined },
    { ...input, document_type: "invoice" },
    { ...input, expected_recipient: "" },
  ]) {
    const denied = endpoint();
    assert.equal((await denied.invoke(invalid)).status, 400);
    assert.equal(denied.dispatched(), 0);
  }
});
test("card endpoint fails closed for expired identity, missing token, foreign origin and inactive delivery", async () => {
  for (const [options, auth, origin, status] of [
    [{ authenticated: false }, true, "https://finviant.com", 401],
    [{}, false, "https://finviant.com", 401],
    [{}, true, "https://attacker.test", 403],
    [{ mode: "disabled" }, true, "https://finviant.com", 503],
  ] as const) {
    const e = endpoint(options);
    assert.equal((await e.invoke(input, auth, origin)).status, status);
    assert.equal(e.calls.length, 0);
    assert.equal(e.dispatched(), 0);
  }
});
test("beta recipient rejection never dispatches and permission/quota errors return actionable failure", async () => {
  for (const error of [
    { code: "42501", message: "BETA_EMAIL_RECIPIENT_NOT_APPROVED" },
    { code: "42501", message: "Business Pro required." },
    { code: "P0001", message: "Email allowance reached." },
  ]) {
    const e = endpoint({ prepError: error }),
      response = await e.invoke();
    assert.ok([403, 409].includes(response.status));
    const detail = await response.json();
    if (error.message === "BETA_EMAIL_RECIPIENT_NOT_APPROVED")
      assert.equal(detail.beta_send_not_started, true);
    assert.equal(e.dispatched(), 0);
  }
});

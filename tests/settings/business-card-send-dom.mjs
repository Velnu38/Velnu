import assert from "node:assert/strict";
import { JSDOM, VirtualConsole } from "jsdom";
import { createServer } from "vite";
process.env.VITE_SUPABASE_URL = "https://test.supabase.co";
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = "test-key";
process.env.VITE_ENABLE_PRIVATE_BETA_EMAIL = "true";
process.env.VITE_ENABLE_CUSTOMER_ACTIONS = "false";
const dom = new JSDOM('<div id="root"></div>', {
  url: "https://finviant.test/?view=dashboard",
  pretendToBeVisual: true,
  virtualConsole: new VirtualConsole(),
});
for (const k of [
  "window",
  "document",
  "HTMLElement",
  "HTMLDialogElement",
  "HTMLInputElement",
  "HTMLSelectElement",
  "Element",
  "Node",
  "Event",
  "CustomEvent",
  "MutationObserver",
  "history",
  "location",
  "localStorage",
  "sessionStorage",
])
  globalThis[k] = k === "window" ? dom.window : dom.window[k];
Object.defineProperty(globalThis, "navigator", {
  value: dom.window.navigator,
  configurable: true,
});
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
dom.window.HTMLDialogElement.prototype.showModal = function () {
  this.open = true;
};
dom.window.confirm = () => true;
const React = await import("react"),
  { act } = React,
  { createRoot } = await import("react-dom/client"),
  root = createRoot(document.getElementById("root")),
  server = await createServer({
    server: { middlewareMode: true, hmr: false },
    appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] },
  });
const B = "11111111-1111-4111-8111-111111111111",
  R = "77777777-7777-4777-8777-777777777777",
  C = "44444444-4444-4444-8444-444444444444",
  T = "a".repeat(64);
const card = {
    name: "Acme Services",
    phone: "7575550123",
    email: "hello@example.test",
    website: "https://example.test",
    tagline: "Repairs",
    include_address: false,
    street: "Private Home",
    city: "City",
    region: "VA",
    postal_code: "23320",
  },
  customer = {
    id: C,
    first_name: "Jordan",
    last_name: "Lee",
    company: "Lee LLC",
    email: "jordan@example.test",
    phone: "7575550124",
    updated_at: "2026-11-08",
  };
let supabase,
  sends = [],
  published = 0,
  pending = null,
  accepted = false,
  publicValid = true,
  exports = 0,
  created = 0,
  tier = "pro";
const tick = () => act(() => new Promise((r) => setTimeout(r, 35))),
  button = (name) =>
    [...document.querySelectorAll("button")].find(
      (x) => x.textContent.trim() === name,
    ),
  click = async (name) => {
    const b = button(name);
    assert.ok(b, name);
    assert.equal(b.disabled, false, name);
    await act(async () => b.click());
    await tick();
  },
  input = (label) =>
    [...document.querySelectorAll("label")]
      .find((x) => x.textContent.startsWith(label))
      ?.querySelector("input"),
  change = async (label, value) => {
    const el = input(label);
    assert.ok(el, label);
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        dom.window.HTMLInputElement.prototype,
        "value",
      ).set.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await tick();
  };
try {
  ({ supabase } = await server.ssrLoadModule("/src/lib/supabase.ts"));
  supabase.rpc = async (name, args) => {
    if (name === "get_business_card")
      return {
        data: { plan: tier, can_edit: true, revision: R, card },
        error: null,
      };
    if (name === "get_business_card_pending")
      return { data: pending, error: null };
    if (name === "get_delivery_setup")
      return {
        data: {
          plan: tier,
          managed_email_ready: true,
          managed_sms_ready: false,
        },
        error: null,
      };
    if (name === "publish_business_card") {
      published++;
      return {
        data: {
          url: "https://finviant.test/?business_card=" + args.p_token,
          expires_at: "2027-02-06",
          revision: R,
        },
        error: null,
      };
    }
    if (name === "get_shared_business_card") {
      exports++;
      return {
        data: publicValid
          ? {
              card,
              branding: { accent: "#195246", logo_path: null },
              vcard:
                "BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Acme Services\r\nEND:VCARD\r\n",
              filename: "E-Business-Card.vcf",
              expires_at: "2027-02-06",
            }
          : null,
        error: null,
      };
    }
    if (name === "get_plan_usage") return { data: { plan: tier }, error: null };
    throw Error(name);
  };
  supabase.from = (name) => {
    assert.equal(name, "customers");
    let operation = "list",
      payload;
    const q = {
      select() {
        return q;
      },
      eq() {
        return q;
      },
      order() {
        return q;
      },
      range: async () => ({ data: [customer], count: 1, error: null }),
      insert(p) {
        created++;
        payload = p;
        operation = "insert";
        return q;
      },
      single: async () => ({ data: { ...customer, ...payload }, error: null }),
    };
    return q;
  };
  Object.defineProperty(supabase, "functions", {
    configurable: true,
    value: {
      invoke: async (name, args) => {
        assert.equal(name, "business-card-delivery");
        sends.push(args.body);
        if (accepted) return { data: { status: "accepted" }, error: null };
        return {
          data: null,
          error: {
            context: new Response(
              JSON.stringify({ error: "Fixture unconfirmed send" }),
              { status: 502 },
            ),
          },
        };
      },
    },
  });
  const { default: Send, BusinessCardQuickLink } = await server.ssrLoadModule(
      "/src/components/SendBusinessCard.tsx",
    ),
    business = { id: B, name: card.name, role: "owner", primary_owner: true };
  await act(async () =>
    root.render(React.createElement(Send, { business, onClose() {} })),
  );
  await tick();
  await tick();
  await change("Find a customer", "Jordan");
  const match = [...document.querySelectorAll(".send-card-matches button")][0];
  assert.ok(match);
  await act(async () => match.click());
  await tick();
  assert.equal(input("Recipient email").value, customer.email);
  assert.equal(input("Update this customer").checked, false);
  assert.equal(created, 0);
  await click("View card / share link");
  assert.ok(
    document.querySelector(".send-card-link a").href.includes("business_card="),
  );
  assert.equal(sends.length, 0);
  await click("Send by Email");
  await click("Check / retry saved send");
  assert.equal(sends.length, 2);
  assert.equal(sends[0].request_id, sends[1].request_id);
  assert.equal(sends[0].customer_id, C);
  assert.equal(sends[0].token, sends[1].token);
  accepted = true;
  await click("Check / retry saved send");
  assert.match(document.body.textContent, /Accepted for delivery/);
  await click("Send to another recipient");
  await change("Find a customer", "new@example.test");
  assert.equal(input("Recipient email").value, "new@example.test");
  assert.equal(input("Save as customer").checked, false);
  await click("Send by Email");
  assert.equal(sends.at(-1).customer_id, null);
  assert.equal(created, 0);
  await click("Send to another recipient");
  await change("Find a customer", "7575550129");
  assert.ok(input("US mobile number"));
  assert.equal(button("Send by Text").disabled, true);
  assert.match(
    document.body.textContent,
    /text sending is awaiting sender activation/,
  );
  await act(async () =>
    root.render(
      React.createElement(BusinessCardQuickLink, { business, onOpen() {} }),
    ),
  );
  await tick();
  assert.ok(document.querySelector("button.card-quick-link"));
  tier = "basic";
  await act(async () =>
    window.dispatchEvent(new Event("finviant-tier-changed")),
  );
  await tick();
  assert.equal(document.querySelector("button.card-quick-link"), null);
  assert.equal(
    document.querySelector("a.plan-navigation-link").textContent,
    "Explore Business Pro",
  );
  const { default: Public } = await server.ssrLoadModule(
    "/src/pages/BusinessCardPage.tsx",
  );
  await act(async () => root.render(React.createElement(Public, { token: T })));
  await tick();
  assert.match(document.body.textContent, /Acme Services/);
  assert.doesNotMatch(document.body.textContent, /Private Home/);
  assert.ok(document.querySelector('a[href="tel:+17575550123"]'));
  assert.ok(document.querySelector('a[href="mailto:hello@example.test"]'));
  await click("Save to Contacts");
  assert.match(document.body.textContent, /Contact file opened or downloaded/);
  assert.equal(exports, 2);
  publicValid = false;
  await act(async () =>
    root.render(React.createElement(Public, { key: "expired", token: T })),
  );
  await tick();
  assert.match(document.body.textContent, /link is unavailable/);
  assert.equal(button("Save to Contacts"), undefined);
  await act(async () => root.unmount());
  console.log(
    "PASS: customer/manual recipients, no forced customer creation, Pro-only Quick Link, preview links, once-only retries, SMS activation, customer card privacy, contact file download and unavailable link handling.",
  );
} finally {
  await supabase?.auth.stopAutoRefresh();
  await supabase?.removeAllChannels();
  await server.close();
  dom.window.close();
}
process.exit(0);

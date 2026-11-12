import assert from "node:assert/strict";
import { JSDOM, VirtualConsole } from "jsdom";
import { createServer } from "vite";
process.env.VITE_SUPABASE_URL = "https://test.supabase.co";
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = "test-key";
process.env.VITE_ENABLE_PRIVATE_BETA_EMAIL = "true";
const dom = new JSDOM('<div id="root"></div>', {
  url: "https://finviant.test/?view=settings&section=documents",
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
  root = createRoot(document.getElementById("root"));
const server = await createServer({
  server: { middlewareMode: true, hmr: false },
  appType: "custom",
  optimizeDeps: { noDiscovery: true, include: [] },
});
const B = "11111111-1111-4111-8111-111111111111",
  revision = "77777777-7777-4777-8777-777777777777";
let tier = "free",
  owner = true,
  saved = false,
  saves = 0,
  exports = 0,
  shares = 0,
  sends = [],
  supabase;
let card = {
  name: "Company Test",
  email: "hello@example.test",
  phone: "7575550123",
  website: "https://example.test",
  tagline: "Services",
  include_address: false,
  street: "Private Home",
  city: "City",
  region: "VA",
  postal_code: "23320",
};
const tick = () => act(() => new Promise((r) => setTimeout(r, 30)));
const button = (name) =>
  [...document.querySelectorAll("button")].find((b) => b.textContent === name);
const click = async (name) => {
  const b = button(name);
  assert.ok(b, name);
  assert.equal(b.disabled, false, name);
  await act(async () => b.click());
  await tick();
};
const input = (label) =>
  [...document.querySelectorAll("label")]
    .find((x) => x.textContent.startsWith(label))
    ?.querySelector("input");
const change = async (label, value) => {
  const el = input(label);
  assert.ok(el, label);
  const setter = Object.getOwnPropertyDescriptor(
    dom.window.HTMLInputElement.prototype,
    "value",
  ).set;
  await act(async () => {
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await tick();
};
try {
  ({ supabase } = await server.ssrLoadModule("/src/lib/supabase.ts"));
  supabase.rpc = async (name, args) => {
    if (name === "get_business_card")
      return {
        data: {
          plan: tier,
          can_edit: owner,
          card: tier === "pro" ? card : null,
          revision: saved ? revision : null,
        },
        error: null,
      };
    if (name === "set_live_business_card") {
      assert.equal(args.p_business,B);assert.equal(args.p_revision,revision);
      return {data:{url:"https://finviant.com/?business_card=88888888-8888-4888-8888-888888888888",published:args.p_published},error:null};
    }
    if (name === "get_delivery_setup")
      return { data: { plan: tier, managed_email_ready: true }, error: null };
    if (name === "save_business_card") {
      assert.equal(args.p_business, B);
      saves++;
      saved = true;
      card = args.p_details;
      return {
        data: { plan: "pro", can_edit: true, card, revision },
        error: null,
      };
    }
    if (name === "export_business_card") {
      exports++;
      assert.equal(args.p_expected_revision, revision);
      return {
        data: {
          filename: "E-Business-Card.vcf",
          vcard:
            "BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Company Test\r\nEND:VCARD\r\n",
          revision,
        },
        error: null,
      };
    }
    throw Error(name);
  };
  Object.defineProperty(supabase, "functions", {
    value: {
      invoke: async (name, args) => {
        assert.equal(name, "send-business-card");
        sends.push(args.body);
        return {
          data: null,
          error: {
            context: new Response(
              JSON.stringify({
                error: "Fixture timeout; retry this same send",
              }),
              { status: 502 },
            ),
          },
        };
      },
    },
    configurable: true,
  });
  const { default: Card } = await server.ssrLoadModule(
    "/src/components/settings/EBusinessCard.tsx",
  );
  const render = async () => {
    await act(async () =>
      root.render(
        React.createElement(Card, {
          key: tier + owner,
          business: {
            id: B,
            name: card.name,
            role: owner ? "owner" : "office",
            primary_owner: owner,
          },
        }),
      ),
    );
    await tick();
    await tick();
  };
  await render();
  assert.equal(button("Set up E-Business Card"), undefined);
  let upgrade = document.querySelector("a.plan-navigation-link");
  assert.equal(upgrade.textContent, "Explore Business Pro");
  assert.ok(upgrade.href.endsWith("&tier=pro"));
  tier = "basic";
  await render();
  assert.ok(document.querySelector("a.plan-navigation-link"));
  assert.equal(saves, 0);
  tier = "pro";
  await render();
  await click("Set up E-Business Card");
  assert.equal(input("Include business address").checked, false);
  assert.equal(document.querySelector(".ebc-address"), null);
  assert.equal(button("Download vCard").disabled, true);
  await click("Save card");
  assert.equal(saves, 1);
  assert.equal(button("Download vCard").disabled, false);
  assert.equal(exports, 1);
  navigator.canShare = () => true;
  navigator.share = async (value) => {
    assert.equal(value.files[0].name, "E-Business-Card.vcf");
    shares++;
  };
  await click("Share vCard");
  assert.equal(shares, 1);
  await change("Business name", "Changed Company");
  assert.equal(button("Share vCard").disabled, true);
  assert.match(
    document.querySelector(".ebc-preview").textContent,
    /Changed Company/,
  );
  await click("Save card");
  assert.equal(saves, 2);
  await click("Publish live card");
  assert.ok(document.querySelector('a[href*="business_card="]'));
  assert.ok(button("Unpublish live card"));
  await click("Unpublish live card");
  assert.equal(button("Unpublish live card"),undefined);
  await change("Recipient email", "recipient@example.test");
  await click("Send card email");
  await tick();
  await tick();
  await click("Retry saved email");
  assert.equal(sends.length, 2);
  assert.equal(
    sends[0].request_id,
    sends[1].request_id,
    "Uncertain retries preserve operation",
  );
  assert.equal(input("Recipient email").disabled, true);
  await click("Cancel");
  owner = false;
  await render();
  await click("Open E-Business Card");
  assert.equal(document.querySelector("fieldset fieldset").disabled, true);
  assert.equal(button("Save card"), undefined);
  assert.equal(button("Share vCard").disabled, false);
  await act(async () => root.unmount());
  console.log(
    "PASS: Free/Individual link-only upgrade; Pro auto-fill/privacy, save/export, native file share, dirty-state protection, email idempotency, read-only office sharing.",
  );
} finally {
  await supabase?.auth.stopAutoRefresh();
  await supabase?.removeAllChannels();
  await server.close();
  dom.window.close();
}
process.exit(0);

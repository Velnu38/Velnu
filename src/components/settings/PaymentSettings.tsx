import { useEffect, useState, type FormEvent } from "react";
import type { CurrentBusiness } from "../../lib/business";
import {
  emptyDocumentSettings,
  getDocumentSettings,
  savePaymentSettings,
  type PaymentSettings as Defaults,
} from "../../services/settings";
import { paymentProviders, validPaymentLink } from "../../lib/paymentLinks";

export default function PaymentSettings({ business }: { business: CurrentBusiness }) {
  const [value, setValue] = useState<Defaults>(emptyDocumentSettings);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    let active = true;
    void getDocumentSettings(business.id).then((settings) => {
      if (active) { setValue(settings); setLoaded(true); }
    }).catch((e) => {
      if (active) setError(e.message || "Unable to load payment options.");
    });
    return () => { active = false; };
  }, [business.id]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !loaded) return;
    setBusy(true); setError(""); setNotice("");
    try {
      if (value.payment_links.some((link) => !validPaymentLink(link))) {
        throw new Error("Use a valid HTTPS payment link from the selected provider.");
      }
      // Save payment fields only; document tax defaults are managed separately.
      await savePaymentSettings(business.id, value);
      setNotice("Payment options saved. New invoices use these options; issued invoices keep their saved details.");
    } catch (e) {
      setError((e as Error).message || "Unable to save payment options.");
    } finally { setBusy(false); }
  }
  if (!loaded) return error ? <p role="alert">{error} <button className="text-button" onClick={() => window.location.reload()}>Reload settings</button></p> : <p role="status">Loading payment options…</p>;
  return (
    <form className="settings-panel" onSubmit={submit}>
      <p className="quiet">Choose how customers can pay your business. Only the primary Finviant account owner can manage these payment options.</p>
      <section className="settings-inset">
        <h3>Receive customer payments</h3>
        <p className="quiet">
          Use links from your own business payment accounts. Buttons appear on
          invoices only. Payments and provider fees are handled directly between
          you and the provider, outside Finviant.
        </p>
        {paymentProviders.map((p) => {
          const link = value.payment_links.find((l) => l.provider === p.id);
          return (
            <div className="payment-provider-setting" key={p.id}>
              <label className="settings-checkbox">
                <input
                  type="checkbox"
                  checked={!!link}
                  onChange={(e) =>
                    setValue({
                      ...value,
                      payment_links: e.target.checked
                        ? [...value.payment_links, { provider: p.id, url: "" }]
                        : value.payment_links.filter(
                            (l) => l.provider !== p.id,
                          ),
                    })
                  }
                />
                <strong>{p.name}</strong>
              </label>
              {link && (
                <label>
                  {p.name} payment link
                  <input
                    type="url"
                    required
                    maxLength={1000}
                    placeholder={p.example}
                    value={link.url}
                    onChange={(e) =>
                      setValue({
                        ...value,
                        payment_links: value.payment_links.map((l) =>
                          l.provider === p.id
                            ? { ...l, url: e.target.value.trim() }
                            : l,
                        ),
                      })
                    }
                  />
                </label>
              )}
            </div>
          );
        })}
        <label>
          Payment instructions
          <textarea
            maxLength={2000}
            placeholder="Please include your invoice number with payment."
            value={value.payment_instructions}
            onChange={(e) =>
              setValue({ ...value, payment_instructions: e.target.value })
            }
          />
        </label>
        <p className="quiet">
          Use business/commercial payment accounts. Confirm payment in the
          provider account before recording it as paid in Finviant. A button
          click does not confirm payment. Fixed-amount links must match the
          invoice balance.
        </p>
      </section>
      <section className="settings-inset">
        <h3>Include payment costs in pricing</h3>
        <label>
          Optional price adjustment (%)
          <input
            type="number"
            min="0"
            max="25"
            step="0.01"
            value={value.pricing_adjustment_percent}
            onChange={(e) =>
              setValue({
                ...value,
                pricing_adjustment_percent: Number(e.target.value),
              })
            }
          />
        </label>
        <p className="quiet">
          You can apply this adjustment to line prices while preparing an
          invoice. It is off by default and uses the same customer price for
          every payment method. Review the price with your customer before
          issuing the invoice. This is not a processor-specific surcharge or a
          guarantee of recovering exact fees.
        </p>
        <p className="quiet">
          PayPal prohibits a surcharge for accepting PayPal. Card surcharges
          have separate provider and legal requirements, so Finviant does not
          add them automatically.
        </p>
      </section>
      {error && <p className="form-message error-text" role="alert">{error}</p>}
      {notice && <p className="form-message" role="status">{notice}</p>}
      <button className="primary-button" disabled={busy}>{busy ? "Saving…" : "Save payment options"}</button>
    </form>
  );
}

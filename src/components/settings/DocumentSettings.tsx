import { useEffect, useState, type FormEvent } from "react";
import {
  draftFromBusiness,
  updateBusinessProfile,
  uploadBusinessLogo,
  type CurrentBusiness,
} from "../../lib/business";
import {
  emptyDocumentSettings,
  getDocumentSettings,
  saveDocumentSettings,
  type DocumentSettings as Defaults,
} from "../../services/settings";
import { paymentProviders, validPaymentLink } from "../../lib/paymentLinks";
import DocumentBrand from "../DocumentBrand";
export default function DocumentSettings({
  business,
  onSaved,
}: {
  business: CurrentBusiness;
  onSaved: (b: CurrentBusiness) => void;
}) {
  const [value, setValue] = useState<Defaults>(emptyDocumentSettings),
    [brand, setBrand] = useState(() => draftFromBusiness(business)),
    [logo, setLogo] = useState<File | null>(null),
    [loaded, setLoaded] = useState(false),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  useEffect(() => {
    let active = true;
    void getDocumentSettings(business.id)
      .then((v) => {
        if (active) {
          setValue(v);
          setLoaded(true);
        }
      })
      .catch((e) => {
        if (active) setError(e.message || "Unable to load document settings.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [business.id]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (value.payment_links.some((l) => !validPaymentLink(l)))
        throw new Error(
          "Use a valid HTTPS payment link from the selected provider.",
        );
      const path = logo ? await uploadBusinessLogo(business, logo) : undefined;
      const saved = await updateBusinessProfile(business, brand, path);
      await saveDocumentSettings(business.id, value);
      onSaved(saved);
      setLogo(null);
      setNotice(
        "Document setup saved. New documents use these defaults; issued documents keep their saved details.",
      );
    } catch (e) {
      setError((e as Error).message || "Unable to save settings.");
    } finally {
      setBusy(false);
    }
  }
  if (!loaded && !loading)
    return (
      <p role="alert">
        {error}{" "}
        <button
          className="text-button"
          onClick={() => window.location.reload()}
        >
          Reload settings
        </button>
      </p>
    );
  if (loading) return <p role="status">Loading document setup…</p>;
  return (
    <form className="settings-panel" onSubmit={submit}>
      <p className="eyebrow">Owner controls</p>
      <h2>Invoice & estimate setup</h2>
      <p className="quiet">
        Set your letterhead, tax defaults, and invoice payment options in one
        place.
      </p>
      <section className="settings-inset">
        <h3>Appearance</h3>
        <div className="profile-field-grid">
          <label>
            Accent color
            <input
              type="color"
              value={brand.document_accent}
              onChange={(e) =>
                setBrand({ ...brand, document_accent: e.target.value })
              }
            />
          </label>
          <label>
            Company logo (PNG, JPG or WebP, up to 2 MB)
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => setLogo(e.target.files?.[0] || null)}
            />
          </label>
          <label className="full">
            Document footer
            <textarea
              maxLength={500}
              value={brand.document_footer}
              onChange={(e) =>
                setBrand({ ...brand, document_footer: e.target.value })
              }
            />
          </label>
        </div>
        <div className="settings-document-preview">
          <DocumentBrand
            business={{
              ...business,
              document_accent: brand.document_accent,
              document_footer: brand.document_footer,
            }}
            kind="Preview"
          />
          {brand.document_footer && <p>{brand.document_footer}</p>}
        </div>
      </section>
      <section className="settings-inset">
        <h3>Taxes</h3>
        <label>
          Default tax rate (%)
          <input
            type="number"
            min="0"
            max="100"
            step="0.01"
            required
            value={value.default_tax_rate}
            onChange={(e) =>
              setValue({ ...value, default_tax_rate: Number(e.target.value) })
            }
          />
        </label>
        <p className="quiet">
          Applied to new invoice and estimate lines. Set an individual line to
          0% when exempt. You determine the applicable tax rate; Finviant does
          not determine tax obligations or file taxes.
        </p>
      </section>
      <section className="settings-inset">
        <h3>Invoice payment buttons</h3>
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
      {error && (
        <p className="form-message error-text" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="form-message" role="status">
          {notice}
        </p>
      )}
      <button className="primary-button" disabled={busy}>
        {busy ? "Saving…" : "Save document setup"}
      </button>
    </form>
  );
}

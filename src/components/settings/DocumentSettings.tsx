import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  draftFromBusiness,
  updateBusinessProfile,
  uploadBusinessLogo,
  type CurrentBusiness,
} from "../../lib/business";
import {
  getDocumentSettings,
  saveDocumentSettings,
} from "../../services/settings";
import { supabase } from "../../lib/supabase";
import DocumentBrand from "../DocumentBrand";
export default function DocumentSettings({
  business,
  onSaved,
}: {
  business: CurrentBusiness;
  onSaved: (b: CurrentBusiness) => void;
}) {
  const saving = useRef(false);
  const [logoAllowed, setLogoAllowed] = useState(false);
  useEffect(() => {
    let active = true;
    setLogoAllowed(false);
    void Promise.resolve(supabase.rpc("get_plan_usage", { target_business_id: business.id })).then(({ data, error }) => {
      if (active) setLogoAllowed(!error && ["basic", "pro"].includes(data?.plan) && Number(data?.logo_bytes_limit || 0) > 0);
    }).catch(() => { if (active) setLogoAllowed(false) });
    return () => { active = false };
  }, [business.id]);
  const [defaultTax, setDefaultTax] = useState(0),
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
          setDefaultTax(v.default_tax_rate);
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
    if (saving.current) return;
    if (logo && !logoAllowed) { setError("Hosted logos require an activated paid plan."); return }
    saving.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const path = logo ? await uploadBusinessLogo(business, logo) : undefined;
      const saved = await updateBusinessProfile(business, brand, path);
      await saveDocumentSettings(business.id, { default_tax_rate: defaultTax });
      onSaved(saved);
      setLogo(null);
      setNotice(
        "Document setup saved. New documents use these defaults; issued documents keep their saved details.",
      );
    } catch (e) {
      setError((e as Error).message || "Unable to save settings.");
    } finally {
      saving.current = false;
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
      <fieldset className="form-dialog-fields" disabled={busy}>
      <p className="quiet">
        Set the appearance and default taxes for your invoices and estimates.
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
          {logoAllowed ? <label>
            Company logo (PNG, JPG or WebP, up to 2 MB)
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => setLogo(e.target.files?.[0] || null)}
            />
          </label> : <p className="form-message">Hosted logo uploads require an activated paid plan. Company-name branding, accent colors and document footers remain available.</p>}
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
            value={defaultTax}
            onChange={(e) =>
              setDefaultTax(Number(e.target.value))
            }
          />
        </label>
        <p className="quiet">
          Applied to new invoice and estimate lines. Set an individual line to
          0% when exempt. You determine the applicable tax rate; Finviant does
          not determine tax obligations or file taxes.
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
      </fieldset>
    </form>
  );
}

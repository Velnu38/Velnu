import { useEffect, useRef, useState } from "react";
import type { CurrentBusiness } from "../../lib/business";
import { isPrimaryOwner } from "../../lib/workspaceAccess";
import { useDeliverySetup } from "../../lib/useDeliverySetup";
import { emailDeliveryEnabled } from "../../lib/releaseFlags";
import { settingsHref } from "../../lib/settingsNavigation";
import {
  getBusinessCard,
  saveBusinessCard,
  exportBusinessCard,
  downloadCard,
  sendBusinessCard,
  type BusinessCard,
  type CardState,
} from "../../services/businessCard";
import FormDialog from "../FormDialog";
import UpgradeLink from "../UpgradeLink";
import "./e-business-card.css";
const sample: BusinessCard = {
  name: "Your Business",
  phone: "(757) 555-0123",
  email: "hello@yourbusiness.com",
  website: "https://yourbusiness.com",
  tagline: "Professional services. Personal attention.",
  include_address: false,
  street: "",
  city: "",
  region: "",
  postal_code: "",
};
function ContactPreview({ card }: { card: BusinessCard }) {
  return (
    <div className="ebc-preview">
      <div className="ebc-monogram" aria-hidden="true">
        {card.name.trim().slice(0, 1).toUpperCase() || "B"}
      </div>
      <h3>{card.name || "Your business name"}</h3>
      <p className="ebc-type">BUSINESS CONTACT</p>
      <dl>
        {[
          ["Phone", card.phone],
          ["Email", card.email],
          ["Website", card.website],
        ]
          .filter(([, v]) => v)
          .map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
      </dl>
      {card.tagline && <p>{card.tagline}</p>}
      {card.include_address && (
        <p className="ebc-address">
          {[card.street, card.city, card.region, card.postal_code]
            .filter(Boolean)
            .join(", ")}
        </p>
      )}
      <small>Contact preview · Appearance varies by phone</small>
    </div>
  );
}
export default function EBusinessCard({
  business,
}: {
  business: CurrentBusiness;
}) {
  const [state, setState] = useState<CardState | null>(null),
    [error, setError] = useState(""),
    [open, setOpen] = useState(false),
    [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    setState(null);
    setError("");
    void getBusinessCard(business.id)
      .then((v) => {
        if (active) setState(v);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [business.id, reload]);
  useEffect(() => {
    const update = () => {
      if (!open) setReload((n) => n + 1);
    };
    window.addEventListener("finviant-tier-changed", update);
    window.addEventListener("focus", update);
    return () => {
      window.removeEventListener("finviant-tier-changed", update);
      window.removeEventListener("focus", update);
    };
  }, [open]);
  return (
    <section className="settings-panel ebc-section">
      <div className="ebc-section-heading">
        <div>
          <p className="eyebrow">BUSINESS PRO EXCLUSIVE</p>
          <h3>E-Business Card</h3>
        </div>
        <span className="ebc-badge">vCard</span>
      </div>
      <p>
        Put your business in their contacts. Turn your business details into one
        professional contact card customers can save on their phone.
      </p>
      {error ? (
        <p role="alert">
          {error}{" "}
          <button
            className="text-button"
            onClick={() => setReload((n) => n + 1)}
          >
            Retry
          </button>
        </p>
      ) : !state ? (
        <p role="status">Loading E-Business Card…</p>
      ) : state.plan !== "pro" ? (
        <div className="ebc-locked">
          <ContactPreview card={sample} />
          <div>
            <h4>Make the next call easier.</h4>
            <p>
              Business Pro includes one company card with unlimited vCard
              downloads and device sharing. Named cards for individual workers
              are not included.
            </p>
            <UpgradeLink
              plan={state.plan}
              required="pro"
              canUpgrade={isPrimaryOwner(business)}
            >
              Explore Business Pro
            </UpgradeLink>
          </div>
        </div>
      ) : (
        <>
          <p className="quiet">
            One shared company card. Only the primary owner edits it; authorized
            office users can download and share it.
          </p>
          <button className="primary-button" onClick={() => setOpen(true)}>
            {state.can_edit && !state.revision
              ? "Set up E-Business Card"
              : "Open E-Business Card"}
          </button>
          {open && (
            <CardEditor
              key={business.id}
              business={business}
              initial={state}
              onClose={() => {
                setOpen(false);
                setReload((n) => n + 1);
              }}
              onSaved={setState}
            />
          )}
        </>
      )}
    </section>
  );
}
export function CardEditor({
  business,
  initial,
  onClose,
  onSaved,
}: {
  business: CurrentBusiness;
  initial: CardState;
  onClose: () => void;
  onSaved: (s: CardState) => void;
}) {
  const [state, setState] = useState(initial),
    [card, setCard] = useState<BusinessCard>(
      Object.fromEntries(
        Object.entries(initial.card!).map(([k, v]) => [
          k,
          typeof v === "string" ? v.replace(/[\r\n\t]+/g, " ").trim() : v,
        ]),
      ) as BusinessCard,
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [file, setFile] = useState<File | null>(null),
    [recipient, setRecipient] = useState(initial.pending_send?.recipient || ""),
    [pending, setPending] = useState(initial.pending_send || null),
    [accepted, setAccepted] = useState(false);
  const saving = useRef(false),
    dirty = JSON.stringify(card) !== JSON.stringify(state.card),
    { setup } = useDeliverySetup(business.id);
  const editable =
    state.can_edit && setup?.plan !== "basic" && setup?.plan !== "free";
  const currentPlan = setup?.plan || state.plan;
  useEffect(() => {
    let active = true;
    setFile(null);
    if (state.revision && currentPlan === "pro")
      void exportBusinessCard(business.id, state.revision)
        .then((v) => {
          if (active)
            setFile(
              new File([v.vcard], v.filename, {
                type: "text/vcard;charset=utf-8",
              }),
            );
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    return () => {
      active = false;
    };
  }, [business.id, state.revision, currentPlan]);
  function change<K extends keyof BusinessCard>(
    key: K,
    value: BusinessCard[K],
  ) {
    setCard((c) => ({ ...c, [key]: value }));
    setNotice("");
    setAccepted(false);
  }
  async function save() {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      const saved = await saveBusinessCard(business.id, card, state.revision);
      setState(saved);
      setCard(saved.card!);
      onSaved(saved);
      setNotice(
        "E-Business Card saved. Existing downloaded copies keep their original details.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  async function share() {
    if (!file) return;
    setError("");
    try {
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: card.name + " — E-Business Card",
        });
        setNotice("Sharing completed.");
      } else {
        downloadCard(file);
        setNotice(
          "Your browser does not support sharing this file. The vCard was downloaded so you can attach it in your email or messaging app.",
        );
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      downloadCard(file);
      setNotice(
        "Sharing is unavailable here. The vCard was downloaded so you can attach it manually.",
      );
    }
  }
  async function send() {
    if (saving.current || !state.revision) return;
    if (
      !pending &&
      !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(recipient.trim())
    ) {
      setError("Enter a valid recipient email.");
      return;
    }
    saving.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    const operation = pending || {
      id: crypto.randomUUID(),
      revision: state.revision,
      recipient: recipient.trim().toLowerCase(),
      status: "queued",
    };
    setPending(operation);
    try {
      const receipt = await sendBusinessCard(
        business.id,
        operation.recipient,
        operation.revision,
        operation.id,
      );
      setPending(null);
      setAccepted(true);
      setNotice(
        receipt.warning ||
          `Email ${receipt.status === "delivered" ? "delivered" : "accepted for delivery"} to ${operation.recipient}. One recipient counts toward your shared monthly email allowance.`,
      );
    } catch (e) {
      if ((e as Error & { notStarted?: boolean }).notStarted) setPending(null);
      setError((e as Error).message);
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  const unavailable = busy || dirty || !file || currentPlan !== "pro";
  return (
    <FormDialog
      label="E-Business Card"
      wide
      busy={busy}
      cleanVersion={state.revision}
      onClose={onClose}
    >
      <header className="ebc-header">
        <div>
          <p className="eyebrow">Invoice & Estimate Setup</p>
          <h2>E-Business Card</h2>
          <p>Make your business easy to reach—and save.</p>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="Close E-Business Card"
          onClick={onClose}
        >
          ×
        </button>
      </header>
      <div className="ebc-grid">
        <div>
          <p className="quiet">
            Pre-filled from your company profile. Card edits apply only to this
            card.
          </p>
          <fieldset className="form-dialog-fields" disabled={!editable || busy}>
            <label>
              Business name
              <input
                required
                maxLength={254}
                value={card.name}
                onChange={(e) => change("name", e.target.value)}
              />
            </label>
            <div className="ebc-fields">
              <label>
                Business phone
                <input
                  type="tel"
                  maxLength={40}
                  value={card.phone}
                  onChange={(e) => change("phone", e.target.value)}
                />
              </label>
              <label>
                Business email
                <input
                  type="email"
                  maxLength={254}
                  value={card.email}
                  onChange={(e) => change("email", e.target.value)}
                />
              </label>
            </div>
            <label>
              Website (optional)
              <input
                type="url"
                placeholder="https://yourbusiness.com"
                maxLength={1000}
                value={card.website}
                onChange={(e) => change("website", e.target.value)}
              />
            </label>
            <label>
              Services / tagline (optional)
              <textarea
                rows={2}
                maxLength={300}
                value={card.tagline}
                onChange={(e) => change("tagline", e.target.value)}
              />
            </label>
            <label className="ebc-check">
              <input
                type="checkbox"
                checked={card.include_address}
                onChange={(e) => change("include_address", e.target.checked)}
              />
              Include business address
            </label>
            <p className="quiet">
              Off by default to protect home-based business addresses.
            </p>
            {card.include_address && (
              <div className="ebc-fields">
                {(["street", "city", "region", "postal_code"] as const).map(
                  (k) => (
                    <label key={k}>
                      {
                        {
                          street: "Street address",
                          city: "City",
                          region: "State / region",
                          postal_code: "Postal code",
                        }[k]
                      }
                      <input
                        maxLength={254}
                        value={card[k]}
                        onChange={(e) => change(k, e.target.value)}
                      />
                    </label>
                  ),
                )}
              </div>
            )}
          </fieldset>
          {!editable && (
            <p className="quiet">
              The primary Business Pro owner manages these details.
            </p>
          )}
          {isPrimaryOwner(business) && (
            <a className="ebc-profile-link" href={settingsHref("company")}>
              Update company profile
            </a>
          )}
        </div>
        <aside>
          <ContactPreview card={card} />
          <div className="ebc-save-note">
            <b>Save straight to phone contacts</b>
            <p>
              Open the .vcf file, then choose Add to Contacts. Saving requires
              the recipient’s confirmation.
            </p>
          </div>
        </aside>
      </div>
      <p className="quiet">
        Unlimited vCard downloads and device sharing. Downloaded cards can be
        saved and forwarded without Finviant limits; future edits do not update
        those copies.
      </p>
      {dirty && (
        <p role="status">Save your changes before downloading or sharing.</p>
      )}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <footer className="ebc-footer">
        <button className="secondary-button" onClick={onClose}>
          Cancel
        </button>
        {editable && (
          <button
            className="secondary-button"
            disabled={busy || (!dirty && !!state.revision)}
            onClick={() => void save()}
          >
            {busy ? "Working…" : "Save card"}
          </button>
        )}
        <button
          className="primary-button"
          disabled={unavailable}
          onClick={() => {
            if (file) {
              downloadCard(file);
              setNotice(
                "vCard downloaded. Open it to save the business to your contacts.",
              );
            }
          }}
        >
          Download vCard
        </button>
        <button
          className="secondary-button"
          disabled={unavailable}
          onClick={() => void share()}
        >
          Share vCard
        </button>
      </footer>
      <details className="ebc-email">
        <summary>Email through Finviant</summary>
        <p>
          One email recipient uses one of your 2,000 shared monthly Pro email
          deliveries. Sender activation is required. Private beta sends are
          limited to approved recipients.
        </p>
        <p className="quiet">
          Send to a customer who has asked for your contact details. Card preview links can be sent by text from Quick Links after SMS activation. You can also download or share the file through a compatible device app.
        </p>
        <label>
          Recipient email
          <input
            type="email"
            data-editor-independent
            maxLength={254}
            value={pending?.recipient || recipient}
            disabled={busy || !!pending}
            onChange={(e) => {
              setRecipient(e.target.value);
              setAccepted(false);
            }}
          />
        </label>
        {pending && (
          <p role="status">
            A saved email is awaiting confirmation. Retry this same send; its
            original recipient and card version stay fixed.
          </p>
        )}
        <button
          className="secondary-button"
          disabled={
            busy ||
            currentPlan !== "pro" ||
            !state.revision ||
            (!pending &&
              (dirty ||
                !setup?.managed_email_ready ||
                !emailDeliveryEnabled ||
                !recipient.trim() ||
                accepted))
          }
          onClick={() => void send()}
        >
          {pending
            ? "Retry saved email"
            : accepted
              ? "Email accepted"
              : "Send card email"}
        </button>
        {(!setup?.managed_email_ready || !emailDeliveryEnabled) && (
          <p className="quiet">
            Finviant email is awaiting activation. Unlimited downloads and
            device sharing remain available.
          </p>
        )}
      </details>
    </FormDialog>
  );
}

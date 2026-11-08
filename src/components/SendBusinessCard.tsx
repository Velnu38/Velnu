import { useEffect, useRef, useState } from "react";
import type { CurrentBusiness } from "../lib/business";
import { isPrimaryOwner } from "../lib/workspaceAccess";
import { useTierUsage } from "../lib/useTierUsage";
import { useDeliverySetup } from "../lib/useDeliverySetup";
import {
  customerActionsEnabled,
  emailDeliveryEnabled,
} from "../lib/releaseFlags";
import { normalizeMobile } from "../lib/smsPhone";
import {
  matchingCustomers,
  customerOptionName,
  type CustomerOption,
} from "../lib/customerSuggestions";
import {
  listCustomers,
  createCustomer,
  updateCustomerContact,
} from "../services/customers";
import {
  getBusinessCard,
  getCardPending,
  publishBusinessCard,
  deliverBusinessCard,
  newCardToken,
  revokeCardLink,
  type CardState,
  type CardOperation,
  type CardLink,
} from "../services/businessCard";
import { CardEditor } from "./settings/EBusinessCard";
import FormDialog from "./FormDialog";
import UpgradeLink from "./UpgradeLink";
import "./send-business-card.css";
const mailPattern = /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/;
type Customer = CustomerOption & { updated_at: string };
export function BusinessCardQuickLink({
  business,
  onOpen,
}: {
  business: CurrentBusiness;
  onOpen: () => void;
}) {
  const usage = useTierUsage(business.id);
  return usage?.plan === "pro" ? (
    <button type="button" className="card-quick-link" onClick={onOpen}>
      <span aria-hidden="true">▣</span>
      <span>
        <strong>Send E-Business Card</strong>
        <small>Share your business contact details</small>
      </span>
      <span aria-hidden="true">›</span>
    </button>
  ) : usage ? (
    <div className="card-upgrade">
      <span>E-Business Card · Business Pro</span>
      <UpgradeLink
        plan={usage.plan}
        required="pro"
        canUpgrade={isPrimaryOwner(business)}
      >
        Explore Business Pro
      </UpgradeLink>
    </div>
  ) : null;
}
export default function SendBusinessCard({
  business,
  onClose,
}: {
  business: CurrentBusiness;
  onClose: () => void;
}) {
  const [state, setState] = useState<CardState | null>(null),
    [customers, setCustomers] = useState<Customer[]>([]),
    [query, setQuery] = useState(""),
    [selected, setSelected] = useState<Customer | null>(null),
    [channel, setChannel] = useState<"email" | "sms">("email"),
    [recipient, setRecipient] = useState(""),
    [consent, setConsent] = useState(false),
    [saveContact, setSaveContact] = useState(false),
    [contactName, setContactName] = useState(""),
    [updateContact, setUpdateContact] = useState(false),
    [editing, setEditing] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [link, setLink] = useState<CardLink | null>(null),
    [pending, setPending] = useState<CardOperation | null>(null),
    [accepted, setAccepted] = useState(false),
    [customerError, setCustomerError] = useState(""),
    [loadVersion, setLoadVersion] = useState(0);
  const flight = useRef(false),
    token = useRef(newCardToken()),
    newCustomer = useRef(crypto.randomUUID()),
    { setup } = useDeliverySetup(business.id);
  useEffect(() => {
    let active = true;
    setError("");
    void Promise.all([
      getBusinessCard(business.id),
      getCardPending(business.id),
    ])
      .then(([s, p]) => {
        if (!active) return;
        setState(s);
        if (p) {
          setPending(p);
          setChannel(p.channel);
          setRecipient(p.recipient);
          if (p.token) token.current = p.token;
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    void listCustomers(business.id)
      .then((c) => {
        if (active) setCustomers(c as Customer[]);
      })
      .catch(() => {
        if (active)
          setCustomerError(
            "Customer search is unavailable. You can still enter an email or phone number.",
          );
      });
    return () => {
      active = false;
    };
  }, [business.id, loadVersion]);
  function choose(customer: Customer) {
    setSelected(customer);
    setQuery(customerOptionName(customer));
    const next = customer.email ? "email" : "sms";
    setChannel(next);
    setRecipient(
      next === "email" ? customer.email || "" : customer.phone || "",
    );
    setAccepted(false);
    setSaveContact(false);
    setUpdateContact(false);
  }
  function method(next: "email" | "sms") {
    setChannel(next);
    setRecipient(
      selected
        ? next === "email"
          ? selected.email || ""
          : selected.phone || ""
        : "",
    );
    setConsent(false);
    setAccepted(false);
    setUpdateContact(false);
  }
  const normalized =
      channel === "email"
        ? recipient.trim().toLowerCase()
        : normalizeMobile(recipient) || "",
    valid =
      channel === "email"
        ? mailPattern.test(normalized)
        : /^\+1\d{10}$/.test(normalized),
    ready =
      channel === "email"
        ? emailDeliveryEnabled && setup?.managed_email_ready
        : customerActionsEnabled && setup?.managed_sms_ready;
  const smsBody =
      (state?.card?.name || "").replace(/[^A-Za-z0-9 .,]/g, "").slice(0, 40) +
      ": Save our business contact: https://finviant.com/?business_card=" +
      token.current +
      " Reply STOP to opt out.",
    segments = smsBody.length <= 160 ? 1 : Math.ceil(smsBody.length / 153);
  async function ensureLink() {
    if (!state?.revision) throw Error("Save the business card first.");
    const value = await publishBusinessCard(
      business.id,
      state.revision,
      token.current,
    );
    setLink(value);
    return value;
  }
  async function preview() {
    if (flight.current) return;
    flight.current = true;
    setBusy(true);
    setError("");
    try {
      await ensureLink();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      flight.current = false;
      setBusy(false);
    }
  }
  async function send() {
    if (flight.current || (!pending && (!valid || !ready || !state?.revision)))
      return;
    flight.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      let op = pending;
      if (!op) {
        let customerId = selected?.id || null;
        if (!selected && saveContact) {
          const c = await createCustomer(
            business.id,
            {
              first_name: contactName,
              email: channel === "email" ? normalized : undefined,
              phone: channel === "sms" ? normalized : undefined,
            },
            newCustomer.current,
          );
          customerId = c.id;
          setSelected(c as Customer);
          setSaveContact(false);
        }
        if (selected && updateContact) {
          const c = await updateCustomerContact(
            business.id,
            selected.id,
            selected.updated_at,
            channel === "email" ? normalized : selected.email || "",
            channel === "sms" ? normalized : selected.phone || "",
          );
          setSelected(c as Customer);
          setUpdateContact(false);
        }
        await ensureLink();
        op = {
          id: crypto.randomUUID(),
          revision: state!.revision!,
          token: token.current,
          recipient: normalized,
          channel,
          customer_id: customerId,
          status: "queued",
        };
        setPending(op);
      }
      const receipt = await deliverBusinessCard(
        business.id,
        op,
        consent || !!pending,
      );
      setPending(null);
      setAccepted(true);
      setNotice(
        receipt.warning ||
          `${receipt.status === "delivered" ? "Delivered" : "Accepted for delivery"} to ${op.recipient}.`,
      );
    } catch (e) {
      if ((e as Error & { notStarted?: boolean }).notStarted) setPending(null);
      setError((e as Error).message);
    } finally {
      flight.current = false;
      setBusy(false);
    }
  }
  function another() {
    setAccepted(false);
    setRecipient("");
    setQuery("");
    setSelected(null);
    setConsent(false);
    setSaveContact(false);
    setLink(null);
    setNotice("");
    token.current = newCardToken();
    newCustomer.current = crypto.randomUUID();
  }
  const matches = query && !selected ? matchingCustomers(customers, query) : [];
  return (
    <>
      <FormDialog
        label="Send E-Business Card"
        busy={busy}
        onClose={onClose}
        cleanVersion={accepted || state?.revision}
        autoFocusFields={false}
      >
        <header className="modal-head">
          <div>
            <p className="eyebrow">{business.name}</p>
            <h2>Send E-Business Card</h2>
          </div>
          <button className="icon-button" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>
        {!state ? (
          <>
            <p role="status">Loading your card…</p>
            {error && (
              <p role="alert">
                {error}{" "}
                <button
                  className="text-button"
                  onClick={() => setLoadVersion((n) => n + 1)}
                >
                  Retry
                </button>
              </p>
            )}
          </>
        ) : state.plan !== "pro" ? (
          <>
            <p>
              One company card with unlimited downloads and device sharing is
              included in Business Pro.
            </p>
            <UpgradeLink
              plan={state.plan}
              required="pro"
              canUpgrade={isPrimaryOwner(business)}
            >
              Explore Business Pro
            </UpgradeLink>
          </>
        ) : (
          <>
            <div className="send-card-summary">
              <strong>{state.card?.name}</strong>
              <p>{state.card?.tagline}</p>
              <small>
                {state.card?.email} {state.card?.phone}
              </small>
            </div>
            {!state.revision ? (
              <>
                <p>
                  Complete the company card before its first send. Your
                  recipient entries stay here while you set it up.
                </p>
                {state.can_edit ? (
                  <button
                    className="secondary-button"
                    onClick={() => setEditing(true)}
                  >
                    Set up card
                  </button>
                ) : (
                  <p>The primary owner needs to finish the card setup.</p>
                )}
              </>
            ) : (
              <>
                <label className="send-card-field">
                  Find a customer or enter an email or mobile number
                  <input
                    autoComplete="off"
                    disabled={!!pending || accepted}
                    value={query}
                    placeholder="Customer name, company, email or phone"
                    onChange={(e) => {
                      const value = e.target.value;
                      setQuery(value);
                      setSelected(null);
                      setUpdateContact(false);
                      setRecipient(value);
                      if (mailPattern.test(value.trim())) setChannel("email");
                      else if (normalizeMobile(value)) setChannel("sms");
                    }}
                  />
                </label>
                {matches.length > 0 && (
                  <div
                    className="send-card-matches"
                    aria-label="Matching customers"
                  >
                    {matches.map((c) => (
                      <button
                        type="button"
                        key={c.id}
                        onClick={() => choose(c as Customer)}
                      >
                        <strong>{customerOptionName(c)}</strong>
                        <small>
                          {[c.company, c.email, c.phone]
                            .filter(Boolean)
                            .join(" · ")}
                        </small>
                      </button>
                    ))}
                  </div>
                )}
                {customerError && <p className="quiet">{customerError}</p>}
                {selected && (
                  <p className="quiet">
                    Customer: {customerOptionName(selected)}
                  </p>
                )}
                <div
                  className="send-card-method"
                  role="group"
                  aria-label="Delivery method"
                >
                  <button
                    type="button"
                    aria-pressed={channel === "email"}
                    disabled={!!pending || accepted}
                    onClick={() => method("email")}
                  >
                    Email
                  </button>
                  <button
                    type="button"
                    aria-pressed={channel === "sms"}
                    disabled={!!pending || accepted}
                    onClick={() => method("sms")}
                  >
                    Text
                  </button>
                </div>
                <label className="send-card-field">
                  {channel === "email" ? "Recipient email" : "US mobile number"}
                  <input
                    type={channel === "email" ? "email" : "tel"}
                    value={recipient}
                    disabled={!!pending || accepted}
                    onChange={(e) => {
                      setRecipient(e.target.value);
                      setAccepted(false);
                    }}
                  />
                </label>
                {!pending &&
                  !accepted &&
                  (selected ? (
                    <label className="send-card-check">
                      <input
                        type="checkbox"
                        checked={updateContact}
                        onChange={(e) => setUpdateContact(e.target.checked)}
                      />
                      Update this customer’s{" "}
                      {channel === "email" ? "email" : "phone number"}
                    </label>
                  ) : (
                    <>
                      <label className="send-card-check">
                        <input
                          type="checkbox"
                          checked={saveContact}
                          onChange={(e) => setSaveContact(e.target.checked)}
                        />
                        Save as customer
                      </label>
                      {saveContact && (
                        <label className="send-card-field">
                          Customer name
                          <input
                            required
                            maxLength={160}
                            value={contactName}
                            onChange={(e) => setContactName(e.target.value)}
                          />
                        </label>
                      )}
                    </>
                  ))}
                <p className="quiet">
                  {channel === "email"
                    ? "Includes the vCard attachment and branded card-preview link. Uses 1 of your 2,000 shared Pro monthly email recipients. Private beta requires an approved recipient."
                    : `Sends the branded preview link. Uses ${segments} of your 200 shared Pro monthly US SMS segments.`}
                </p>
                {channel === "sms" && !pending && (
                  <label className="send-card-check">
                    <input
                      type="checkbox"
                      checked={consent}
                      onChange={(e) => setConsent(e.target.checked)}
                    />
                    The customer agreed to receive this business text at this
                    number.
                  </label>
                )}
                {!ready && (
                  <p className="form-message">
                    Finviant {channel === "email" ? "email" : "text"} sending is
                    awaiting sender activation. You can still preview and share
                    the card link.
                  </p>
                )}
                {pending && (
                  <p role="status">
                    A saved {pending.channel === "email" ? "email" : "text"} is
                    awaiting confirmation. Its recipient and card version stay
                    fixed. Uncertain texts require activity review and will not
                    be sent again automatically.
                  </p>
                )}
                <div className="send-card-actions">
                  {accepted ? (
                    <button className="primary-button" onClick={another}>
                      Send to another recipient
                    </button>
                  ) : (
                    <button
                      className="primary-button"
                      disabled={
                        busy ||
                        (!pending &&
                          (!valid ||
                            !ready ||
                            (channel === "sms" && !consent) ||
                            (!selected && saveContact && !contactName.trim())))
                      }
                      onClick={() => void send()}
                    >
                      {busy
                        ? "Working…"
                        : pending
                          ? "Check / retry saved send"
                          : channel === "email"
                            ? "Send by Email"
                            : "Send by Text"}
                    </button>
                  )}
                  <button
                    className="secondary-button"
                    disabled={busy || !!pending}
                    onClick={() => void preview()}
                  >
                    View card / share link
                  </button>
                </div>
                {link && (
                  <div className="send-card-link" data-editor-independent>
                    <a
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Open customer preview
                    </a>
                    <label>
                      Shareable link
                      <input
                        readOnly
                        value={link.url}
                        onFocus={(e) => e.target.select()}
                      />
                    </label>
                    <p className="quiet">
                      Anyone with this link can view the card. Available until{" "}
                      {new Date(link.expires_at).toLocaleDateString()}. Saved
                      contact files do not expire.
                    </p>
                    <button
                      className="text-button"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(link.url);
                          setNotice("Card link copied.");
                        } catch {
                          setNotice(
                            "Select and copy the shareable link above.",
                          );
                        }
                      }}
                    >
                      Copy link
                    </button>
                    {isPrimaryOwner(business) && (
                      <button
                        className="text-button"
                        onClick={async () => {
                          try {
                            await revokeCardLink(business.id, token.current);
                            setLink(null);
                            token.current = newCardToken();
                            setNotice(
                              "This preview link was withdrawn. Previously saved contact files remain usable.",
                            );
                          } catch (e) {
                            setError((e as Error).message);
                          }
                        }}
                      >
                        Withdraw this link
                      </button>
                    )}
                  </div>
                )}
                {state.can_edit && (
                  <button
                    className="text-button"
                    disabled={busy || !!pending}
                    onClick={() => setEditing(true)}
                  >
                    Manage card
                  </button>
                )}
              </>
            )}
            {error && (
              <p role="alert" className="error-text">
                {error}
              </p>
            )}
            {notice && <p role="status">{notice}</p>}
          </>
        )}
      </FormDialog>
      {editing && state && (
        <CardEditor
          business={business}
          initial={state}
          onSaved={(s) => {
            setState(s);
            setLink(null);
            token.current = newCardToken();
          }}
          onClose={() => setEditing(false)}
        />
      )}
    </>
  );
}

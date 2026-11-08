import { useEffect, useState, type CSSProperties } from "react";
import { supabase } from "../lib/supabase";
import { businessLogoUrl } from "../lib/business";
import { downloadCard, type BusinessCard } from "../services/businessCard";
import { normalizeMobile } from "../lib/smsPhone";
type SharedCard = {
  card: BusinessCard;
  branding: { accent: string; logo_path: string | null };
  vcard: string;
  filename: string;
  expires_at: string;
};
const demoCard: SharedCard = {
  card: {
    name: "Oak & Stone Landscaping",
    phone: "(757) 555-0123",
    email: "hello@example.com",
    website: "https://example.com",
    tagline: "Thoughtful landscapes. Reliable service.",
    include_address: false,
    street: "",
    city: "",
    region: "",
    postal_code: "",
  },
  branding: { accent: "#195246", logo_path: null },
  vcard: [
    "BEGIN:VCARD",
    "VERSION:3.0",
    "FN:Oak & Stone Landscaping",
    "N:Oak & Stone Landscaping;;;;",
    "ORG:Oak & Stone Landscaping",
    "TEL;TYPE=WORK,VOICE:+17575550123",
    "EMAIL;TYPE=WORK,INTERNET:hello@example.com",
    "URL:https://example.com",
    "END:VCARD",
    "",
  ].join("\r\n"),
  filename: "Example-E-Business-Card.vcf",
  expires_at: "2099-01-01",
};
export default function BusinessCardPage({ token }: { token: string }) {
  const [data, setData] = useState<SharedCard | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [retry, setRetry] = useState(0),
    [logoFailed, setLogoFailed] = useState(false);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setData(null);
    setNotice("");
    setError("");
    if (token === "demo") {
      setData(demoCard);
      setLoading(false);
      return;
    }
    if (!/^[a-f0-9]{64}$/.test(token)) {
      setLoading(false);
      return;
    }
    void Promise.resolve(
      supabase.rpc("get_shared_business_card", { p_token: token }),
    )
      .then(({ data, error }) => {
        if (!active) return;
        if (error) {
          setError("The card could not be loaded. Please try again.");
          return;
        }
        setData(data as SharedCard | null);
      })
      .catch(() => {
        if (active) setError("The card could not be loaded. Please try again.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [token, retry]);
  const card = data?.card,
    phone = normalizeMobile(card?.phone || ""),
    validEmail =
      card?.email && /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(card.email),
    logo =
      data?.branding.logo_path && !logoFailed
        ? businessLogoUrl(data.branding)
        : null;
  const website =
    card?.website && /^https?:\/\/[^\s<>]+$/.test(card.website)
      ? card.website
      : null;
  const accent =
    data?.branding.accent && /^#[a-f0-9]{6}$/i.test(data.branding.accent)
      ? data.branding.accent
      : "#195246";
  async function save() {
    if (!data) return;
    try {
      const fresh =
        token === "demo"
          ? { data: demoCard, error: null }
          : await supabase.rpc("get_shared_business_card", {
              p_token: token,
            });
      if (fresh.error)
        throw Error("Unable to download this contact. Try again.");
      if (!fresh.data) {
        setData(null);
        setNotice("");
        return;
      }
      downloadCard(
        new File([fresh.data.vcard], fresh.data.filename, {
          type: "text/vcard;charset=utf-8",
        }),
      );
      setNotice(
        "Contact file opened or downloaded. Choose Add to Contacts, or open the downloaded .vcf file to import it.",
      );
    } catch (e) {
      setNotice((e as Error).message);
    }
  }
  return (
    <main
      className="public-business-card"
      style={{ "--card-accent": accent } as CSSProperties}
    >
      <header className="pbc-brand">
        <img src="/finviant-mark.svg" alt="" />
        <span>Finviant</span>
      </header>
      {loading ? (
        <p className="pbc-loading" role="status">
          Opening business card…
        </p>
      ) : error ? (
        <section className="pbc-card">
          <h1>Unable to open this card</h1>
          <p role="alert">{error}</p>
          <button onClick={() => setRetry((n) => n + 1)}>Try again</button>
        </section>
      ) : !card ? (
        <section className="pbc-card">
          <h1>This card link is unavailable</h1>
          <p>
            It may have expired or been withdrawn. Ask the business to send a
            new card. A contact file you already saved remains usable.
          </p>
        </section>
      ) : (
        <>
          <div className="pbc-banner">
            <svg viewBox="0 0 160 100" aria-hidden="true">
              <path d="M10 85Q80 15 150 5Q150 85 10 85ZM10 85L120 30M50 60L55 35M85 40L110 60" />
            </svg>
            <p>
              {token === "demo" ? "EXAMPLE E-BUSINESS CARD" : "E-BUSINESS CARD"}
            </p>
          </div>
          <article className="pbc-card">
            <div className="pbc-company-logo">
              {logo ? (
                <img
                  src={logo}
                  alt={card.name + " logo"}
                  onError={() => setLogoFailed(true)}
                />
              ) : (
                <span aria-hidden="true">
                  {card.name.slice(0, 1).toUpperCase()}
                </span>
              )}
            </div>
            <h1>{card.name}</h1>
            {card.tagline && <p className="pbc-tagline">{card.tagline}</p>}
            <div className="pbc-gold-line" />
            <dl>
              {card.phone && (
                <div>
                  <dt>Phone</dt>
                  <dd>
                    {phone ? (
                      <a href={"tel:" + phone}>{card.phone}</a>
                    ) : (
                      card.phone
                    )}
                  </dd>
                </div>
              )}
              {card.email && (
                <div>
                  <dt>Email</dt>
                  <dd>
                    {validEmail ? (
                      <a href={"mailto:" + card.email}>{card.email}</a>
                    ) : (
                      card.email
                    )}
                  </dd>
                </div>
              )}
              {website && (
                <div>
                  <dt>Website</dt>
                  <dd>
                    <a href={website} target="_blank" rel="noopener noreferrer">
                      {website.replace(/^https?:\/\//, "")}
                    </a>
                  </dd>
                </div>
              )}
              {card.include_address && (
                <div>
                  <dt>Address</dt>
                  <dd>
                    {[card.street, card.city, card.region, card.postal_code]
                      .filter(Boolean)
                      .join(", ")}
                  </dd>
                </div>
              )}
            </dl>
            <button
              type="button"
              className="pbc-save"
              onClick={() => void save()}
            >
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                aria-hidden="true"
              >
                <circle cx="9" cy="7" r="4" />
                <path d="M2 22v-3a7 7 0 0114 0v3M20 7v8M16 11h8" />
              </svg>{" "}
              Save to Contacts
            </button>
            <p className="pbc-help">
              Opens a contact file. Confirm Add to Contacts on your phone.
            </p>
            <div className="pbc-secondary">
              {phone && <a href={"tel:" + phone}>Call Business</a>}
              {validEmail && (
                <a href={"mailto:" + card.email}>Email Business</a>
              )}
            </div>
            <p className="pbc-help">No account or sign-in needed.</p>
            {notice && (
              <p role="status" className="pbc-notice">
                {notice}
              </p>
            )}
          </article>
          <footer className="pbc-footer">
            Shared through Finviant
            <small>
              {token === "demo"
                ? "Example business details. Saving contacts requires your confirmation."
                : `Preview link available until ${new Date(data!.expires_at).toLocaleDateString()}. Saved contacts do not expire.`}
            </small>
          </footer>
        </>
      )}
    </main>
  );
}

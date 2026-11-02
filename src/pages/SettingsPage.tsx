import { useState } from "react";
import IntegrationSettings from "../components/calendar/IntegrationSettings";
import type { CurrentBusiness } from "../lib/business";
import { canAccess, isPrimaryOwner } from "../lib/workspaceAccess";
import BusinessProfileEditor from "../components/BusinessProfileEditor";
import TeamSettings from "../components/settings/TeamSettings";
import DocumentSettings from "../components/settings/DocumentSettings";
import SubscriptionSettings from "../components/settings/SubscriptionSettings";
import "../components/settings/settings.css";
type Section = "company" | "team" | "documents" | "calendar" | "subscription";
const options: {
  id: Section;
  title: string;
  description: string;
  icon: string;
}[] = [
  {
    id: "company",
    title: "Company profile",
    description: "Business identity, contact details, and services.",
    icon: "C",
  },
  {
    id: "team",
    title: "Team & access",
    description: "Five Pro users. Invite your team and choose their access.",
    icon: "5",
  },
  {
    id: "documents",
    title: "Invoice & estimate setup",
    description: "Letterhead, taxes, and invoice payment buttons.",
    icon: "D",
  },
  {
    id: "calendar",
    title: "Calendar connections",
    description: "Connect Google or Outlook and manage synchronization.",
    icon: "▦",
  },
  {
    id: "subscription",
    title: "Subscription",
    description: "View subscription status or cancel renewal.",
    icon: "S",
  },
];
export default function SettingsPage({
  business,
  onSaved,
}: {
  business: CurrentBusiness;
  onSaved: (b: CurrentBusiness) => void;
}) {
  const [section, setSection] = useState<Section | null>(null);
  const owner = isPrimaryOwner(business);
  const allowed = options.filter((o) =>
    o.id === "calendar" ? canAccess(business, "calendar") : owner,
  );
  return (
    <div className="page-stack">
      <div className="page-heading">
        <p className="eyebrow">Settings · {business.name}</p>
        <h1>Manage your workspace.</h1>
        <p className="quiet">Choose an area to update.</p>
      </div>
      {section && (
        <button
          className="text-button settings-back"
          onClick={() => setSection(null)}
        >
          ← All settings
        </button>
      )}
      {!section ? (
        <div className="settings-options">
          {allowed.map((o) => (
            <button
              className="settings-option"
              key={o.id}
              onClick={() => setSection(o.id)}
            >
              <span aria-hidden="true">{o.icon}</span>
              <div>
                <strong>{o.title}</strong>
                <p>{o.description}</p>
              </div>
              <b aria-hidden="true">↗</b>
            </button>
          ))}
          {!owner && (
            <p className="quiet">
              Your primary business owner manages team access, company
              documents, and the subscription.
            </p>
          )}
        </div>
      ) : (
        <>
          {section === "company" && owner && (
            <BusinessProfileEditor
              business={business}
              onSaved={onSaved}
              companyOnly
            />
          )}
          {section === "team" && owner && <TeamSettings business={business} />}{" "}
          {section === "documents" && owner && (
            <DocumentSettings business={business} onSaved={onSaved} />
          )}{" "}
          {section === "calendar" && canAccess(business, "calendar") && (
            <IntegrationSettings businessId={business.id} />
          )}{" "}
          {section === "subscription" && owner && (
            <SubscriptionSettings businessId={business.id} />
          )}
        </>
      )}
    </div>
  );
}

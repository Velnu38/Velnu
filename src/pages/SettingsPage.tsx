import IntegrationTesting, { integrationTestingAvailable } from '../components/settings/IntegrationTesting'
import WorkspaceBack from '../components/WorkspaceBack'
import { useState } from "react";
import IntegrationSettings from "../components/calendar/IntegrationSettings";
import type { CurrentBusiness } from "../lib/business";
import { canAccess, isPrimaryOwner } from "../lib/workspaceAccess";
import BusinessProfileEditor from "../components/BusinessProfileEditor";
import TeamSettings from "../components/settings/TeamSettings";
import DocumentSettings from "../components/settings/DocumentSettings";
import SubscriptionSettings from "../components/settings/SubscriptionSettings";
import SchedulingSettings from "../components/scheduling/SchedulingSettings";
import "../components/settings/settings.css";

type Section = "company" | "team" | "documents" | "calendar" | "scheduling" | "subscription" | "testing";
const options: { id: Section; title: string; description: string }[] = [
  { id: "company", title: "Company profile", description: "Business details and services." },
  { id: "team", title: "Team & access", description: "Invite your team and choose their access." },
  { id: "documents", title: "Invoice & estimate setup", description: "Document appearance, branding, and taxes." },
  { id: "calendar", title: "Calendar connections", description: "Google Calendar and Microsoft Outlook." },
  { id: "scheduling", title: "Scheduling & team availability", description: "Working hours, booking notice, travel time, and time off." },
  { id: "subscription", title: "Cancel subscription", description: "View your subscription and manage cancellation." },
];

export default function SettingsPage({ business, onSaved }: {
  business: CurrentBusiness;
  onSaved: (business: CurrentBusiness) => void;
}) {
  const [visited,setVisited]=useState<Set<Section>>(()=>new Set())
  const [section, setSection] = useState<Section | null>(()=>integrationTestingAvailable && new URLSearchParams(location.search).has("integration_test") ? "testing" : null);
  const owner = isPrimaryOwner(business);
  const allowed = [...options, ...(integrationTestingAvailable ? [{id: "testing" as Section,title: "Integration testing",description: "Private Stripe and approved Twilio SMS tests."}] : [])].filter((option) => option.id === "calendar" ? canAccess(business, "calendar") : option.id === "scheduling" ? ['owner','admin','office'].includes(business.role) && canAccess(business,'calendar') && canAccess(business,'jobs') : owner);

  function content(id: Section) {
    if (id === "testing") return <IntegrationTesting businessId={business.id} />;
    if (id === "company") return <BusinessProfileEditor business={business} onSaved={onSaved} companyOnly />;
    if (id === "team") return <TeamSettings business={business} />;
    if (id === "documents") return <DocumentSettings business={business} onSaved={onSaved} />;
    if (id === "calendar") return <IntegrationSettings businessId={business.id} />;
    if (id === "scheduling") return <SchedulingSettings business={business} />;
    return <SubscriptionSettings businessId={business.id} />;
  }

  return (
    <div className="page-stack"><WorkspaceBack />
      <div className="page-heading">
        <p className="eyebrow">{business.name}</p>
        <h1>Settings</h1>
        <p className="quiet">Open an option below to make changes.</p>
      </div>
      <div className="settings-options">
        {allowed.map((option) => {
          const expanded = section === option.id;
          return (
            <section className="settings-disclosure" key={option.id}>
              <h2 className="settings-disclosure-heading">
                <button
                  type="button"
                  id={`settings-${option.id}-trigger`}
                  className="settings-option"
                  aria-label={option.title}
                  aria-expanded={expanded}
                  aria-controls={`settings-${option.id}-content`}
                  onClick={() => {setVisited(prev=>new Set([...prev,option.id]));setSection(expanded ? null : option.id)}}
                >
                  <span className="settings-option-copy"><strong>{option.title}</strong><span>{option.description}</span></span>
                  <svg className="settings-chevron" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
                </button>
              </h2>
              <div id={`settings-${option.id}-content`} className="settings-disclosure-content" role="region" aria-labelledby={`settings-${option.id}-trigger`} hidden={!expanded}>
                {(expanded || visited.has(option.id)) && content(option.id)}
              </div>
            </section>
          );
        })}
      </div>
      {!owner && <p className="quiet">Your primary business owner manages team access, document setup and the subscription.</p>}
    </div>
  );
}

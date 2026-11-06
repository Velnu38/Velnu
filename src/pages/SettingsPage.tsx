import { isPrimaryOwner } from '../lib/workspaceAccess'
import { useTierUsage } from '../lib/useTierUsage'
import PlansAndUsage from '../components/settings/PlansAndUsage'
import DeliverySetup from '../components/settings/DeliverySetup'
import StorageUsage from '../components/StorageUsage'
import SmsSetup from '../components/settings/SmsSetup'
import IntegrationTesting from '../components/settings/IntegrationTesting'
import WorkspaceBack from '../components/WorkspaceBack'
import SupportCases from '../components/SupportCases'
import { adminRequest } from '../services/platformAdmin'
import './platform-admin.css'
import { useState, useEffect } from "react";
import IntegrationSettings from "../components/calendar/IntegrationSettings";
import type { CurrentBusiness } from "../lib/business";
import MoreNavigation from '../components/MoreNavigation'
import { canOpenSettingsSection, settingsHref, settingsOptionForPlan, settingsOptions, settingsSectionFromSearch, type SettingsSection } from '../lib/settingsNavigation'
import BusinessProfileEditor from "../components/BusinessProfileEditor";
import TeamSettings from "../components/settings/TeamSettings";
import DocumentSettings from "../components/settings/DocumentSettings";
import SubscriptionSettings from "../components/settings/SubscriptionSettings";
import SchedulingSettings from "../components/scheduling/SchedulingSettings";
import "../components/settings/settings.css";

export default function SettingsPage({ business, onSaved }: {
  business: CurrentBusiness;
  onSaved: (business: CurrentBusiness) => void;
}) {
  const [operator,setOperator]=useState(false)
  useEffect(()=>{let active=true;void adminRequest<{operator:boolean}>('access').then(r=>{if(active)setOperator(r.operator===true)}).catch(()=>{});return()=>{active=false}},[])
  // AppShell remounts the page on links and browser history changes, after its
  // unsaved-change guard. Direct URLs retain their original section IDs.
  const section = settingsSectionFromSearch(window.location.search)
  const plan = useTierUsage(business.id)?.plan
  const requestedOption = settingsOptions.find(option => option.id === section)
  const option = requestedOption && settingsOptionForPlan(requestedOption, plan)
  const permitted = section !== null && canOpenSettingsSection(business, section)

  function content(id: SettingsSection) {
    if (id === "plans") return <PlansAndUsage businessId={business.id}/>;
    if (id === "delivery") return <DeliverySetup businessId={business.id}/>;
    if (id === "storage") return <StorageUsage key={business.id} businessId={business.id} detailed />;
    if (id === "sms") return <SmsSetup businessId={business.id} />;
    if (id === "support") return <SupportCases businessId={business.id} />;
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
        <h1>{option?.title || 'More'}</h1>
        <p className="quiet">{option?.description || 'Manage your business, setup, and connections.'}</p>
      </div>
      {operator && <p><a className="secondary-button" href="/admin">Open Finviant Admin Dashboard</a></p>}
      {section === null ? <MoreNavigation business={business}/> : !permitted ? <p role="alert">This area is not included in your access. Contact your primary business owner.</p> : option ? content(section) : plan ? <p role="status">This setup requires an eligible plan. {isPrimaryOwner(business) && <a href={settingsHref('plans')}>Compare plans</a>}</p> : <p role="status">Checking plan access…</p>}
    </div>
  );
}

import React from 'react';
import { createRoot } from 'react-dom/client';
import WorkspaceErrorBoundary from './components/WorkspaceErrorBoundary';
import './styles.css';
import './modules.css';
import './customer-detail.css';
import './conversion.css';
import './invoice-detail.css';
import './mobile-nav.css';
import './change-orders.css';
import './customer-approval.css';
import './office-dashboard.css';
import './company-profile.css';
import './marketing.css'
import './services.css';
import './bookkeeping.css';
import './google-maps.css';
import './dashboard-redesign.css';
import './calendar.css';
import './workspace-consistency.css';
import './workspace-tabs.css';

const container = document.getElementById('root');
if (!container) throw new Error('Missing root element');

function StartupReady() {
  React.useEffect(() => {
    window.dispatchEvent(new Event('finviant:app-mounted'));
  }, []);
  return null;
}

// Catch module initialization failures as well as failed downloads. A static
// App import can fail before React gets a chance to render its error boundary.
void import('./App').then(({ default: App }) => {
  createRoot(container).render(
    <React.StrictMode>
      <WorkspaceErrorBoundary><App /></WorkspaceErrorBoundary>
      <StartupReady />
    </React.StrictMode>,
  );
}).catch((error: unknown) => {
  window.dispatchEvent(new CustomEvent('finviant:startup-error', { detail: error }));
});

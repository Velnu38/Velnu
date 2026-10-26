import { useState } from 'react'

const offerCards = [
  { eyebrow: '01 · Start simple', title: 'Look professional from the first estimate.', copy: 'Set up your company details, colors and logo once. Carry your identity into invoices and estimates.', kind: 'Available in private beta', icon: '◫' },
  { eyebrow: '02 · Keep work organized', title: 'Customers, jobs and schedules together.', copy: 'Keep the people, work and follow-up connected so information does not get lost between calls.', kind: 'Available in private beta', icon: '◇' },
  { eyebrow: '03 · Spend less time typing', title: 'Speak it. Review it. Save a draft.', copy: 'Turn a short spoken instruction into editable text and a document draft. Owner approval comes before saving or sending.', kind: 'AI rollout in progress', icon: '◎' },
  { eyebrow: '04 · Keep financial records clear', title: 'Know what’s paid. Know what’s spent.', copy: 'Your Bookkeeping workbook pulls in recorded invoice payments and lets you track expenses. An optional QuickBooks Online import is being tested.', kind: 'Workbook in beta · Intuit setup pending', icon: '↗' },
  { eyebrow: '05 · Put the customer first', title: 'Professional estimate review and approval.', copy: 'Let customers examine scope, totals and terms before explicitly accepting a quote.', kind: 'Customer delivery coming soon', icon: '✓' },
  { eyebrow: '06 · Grow into a smarter office', title: 'Business-aware assistance.', copy: 'Provide your services, service area and team context so future AI features can use your terminology rather than guess.', kind: 'Expanded AI planned', icon: '✳' },
]
const plans = [
  { name: 'Free', kicker: 'Start with the essentials', price: 'Free', detail: 'Pricing and usage terms may change after the beta.', featured: false, features: [
    'Manual invoices and estimates',
    'Customer and job records',
    'Company name, contact details and logo',
    'Printable branded document previews',
    'No paid AI usage',
  ] },
  { name: 'Basic', kicker: 'Make routine work easier', price: 'Coming soon', detail: 'Price and AI allowances to be announced.', featured: true, features: [
    'Everything in Free',
    'Voice-assisted invoice and estimate drafts',
    'AI interpretation of business requests',
    'Business-context assistance',
    'AI usage limits to be published',
  ] },
  { name: 'Pro', kicker: 'More capability for growing teams', price: 'Coming soon', detail: 'Features, price and limits to be announced.', featured: false, features: [
    'Everything in Basic',
    'Expanded assistant and workflow features',
    'Customer approval and delivery tools',
    'Advanced reminders and automation',
    'Additional team and messaging capabilities',
  ] },
]
const questions = [
  { q: 'Can I use Velnu without AI?', a: 'Yes. Manual invoicing, estimating and business records are part of the Free plan proposal. AI-assisted functions are designed as optional paid capabilities.' },
  { q: 'Will Velnu send an invoice without me approving it?', a: 'No. The workflow is designed around owner review. Voice and AI can prepare drafts, but customer-facing actions require your confirmation.' },
  { q: 'Is Velnu ready for my entire business?', a: 'Velnu is a private beta. Some features and integrations, including live customer email delivery, are still being tested. Keep independent copies of important records.' },
  { q: 'What will Basic and Pro cost?', a: 'Prices are not set yet. We will publish package details and usage allowances before requesting payment.' },
]

export default function LandingPage() {
  const [openFaq, setOpenFaq] = useState<number | null>(0)
  return <div className="marketing-page">
    <header className="marketing-topbar">
      <div className="marketing-container marketing-nav">
        <a className="marketing-brand" href="/" aria-label="Velnu home"><span className="marketing-logo">V</span><strong>velnu<span className="brand-dot">.</span></strong></a>
        <nav aria-label="Main navigation" className="marketing-main-nav"><a href="#features">Features</a><a href="#how-it-works">How it works</a><a href="#pricing">Pricing</a></nav>
        <div className="marketing-nav-actions"><a className="marketing-signin" href="/auth?mode=signin">Sign in</a><a className="marketing-btn marketing-btn-dark marketing-btn-small" href="/auth?mode=signup">Join private beta <span aria-hidden="true">↗</span></a></div>
      </div>
    </header>
    <main>
      <section className="marketing-hero">
        <div className="marketing-container marketing-hero-grid">
          <div className="marketing-hero-copy">
            <div className="marketing-beta"><span className="marketing-live-dot" /> Built for the owner who does it all · Private beta</div>
            <h1>Your work. <em>Less paperwork.</em></h1>
            <p className="marketing-hero-lead">Meet Velnu, the business workspace that helps you turn everyday work into professional estimates and invoices—without a complicated back office.</p>
            <div className="marketing-hero-actions"><a href="/auth?mode=signup" className="marketing-btn marketing-btn-accent">Get started with Velnu <span>↗</span></a><a href="#how-it-works" className="marketing-watch">See how it works <span aria-hidden="true">↓</span></a></div>
            <p className="marketing-hero-fine">No pricing commitment during the private beta. AI and customer email features are being rolled out.</p>
            <div className="marketing-hero-statline"><span><strong>One place</strong> for customers and jobs</span><span><strong>Your brand</strong> on every document</span><span><strong>Your review</strong> before anything goes out</span></div>
          </div>
          <div className="marketing-scene" role="img" aria-label="Illustrative Velnu interface showing a spoken request, an invoice draft, and company branding">
            <div className="marketing-orbit marketing-orbit-one" /><div className="marketing-orbit marketing-orbit-two" />
            <div className="marketing-float-label">A clearer way to work.</div>
            <div className="marketing-demo-window">
              <div className="marketing-demo-header"><div className="marketing-demo-brand"><span className="marketing-logo">V</span><strong>Velnu</strong><span>Workspace</span></div><div className="marketing-demo-dots"><i /><i /><i /></div></div>
              <div className="marketing-demo-body">
                <div className="marketing-demo-sidebar"><span>Overview</span><span>Customers</span><span>Estimates</span><span className="on">Invoices</span><span>Schedule</span></div>
                <div className="marketing-demo-main">
                  <p className="marketing-demo-kicker">INVOICE DRAFT</p><h3>Every job deserves a professional finish.</h3>
                  <div className="marketing-demo-invoice">
                    <div className="marketing-demo-company"><div className="marketing-demo-avatar">S</div><div><b>Summit Home Services</b><small>Business details & logo</small></div><span>INVOICE</span></div>
                    <div className="marketing-demo-detail"><div><small>Prepared for</small><strong>Jordan Taylor</strong></div><div><small>Reference</small><strong>INV–1004</strong></div></div>
                    <div className="marketing-demo-line"><span>Service visit and faucet repair</span><b>$185.00</b></div>
                    <div className="marketing-demo-total"><span>Draft total</span><b>$185.00</b></div>
                    <div className="marketing-demo-draft">Draft · Review before saving</div>
                  </div>
                </div>
              </div>
            </div>
            <div className="marketing-voice-card"><div className="marketing-voice-icon">◉</div><div><span>VOICE REQUEST · EXAMPLE</span><strong>“Invoice Jordan $185 for faucet repair.”</strong></div><div className="marketing-wave" aria-hidden="true"><i /><i /><i /><i /><i /><i /><i /></div></div>
          </div>
        </div>
      </section>
      <section className="marketing-trust"><div className="marketing-container marketing-trust-inner"><p>Made for service businesses that need to keep moving.</p><div><span>Home services</span><span>Independent contractors</span><span>Field teams</span><span>Local businesses</span></div></div></section>
      <section id="features" className="marketing-features"><div className="marketing-container">
        <div className="marketing-section-intro"><div><p className="marketing-section-kicker">THE TOOLS THAT MATTER</p><h2>Run the work.<br /><span>Not the paperwork.</span></h2></div><p>Velnu brings together the practical pieces of running a service business, with voice and AI features added carefully where they actually help.</p></div>
        <div className="marketing-features-grid">{offerCards.map(feature=><article key={feature.eyebrow} className="marketing-feature-card"><div className="marketing-feature-top"><span className="marketing-feature-icon">{feature.icon}</span><span>{feature.kind}</span></div><p className="marketing-section-kicker">{feature.eyebrow}</p><h3>{feature.title}</h3><p>{feature.copy}</p></article>)}</div>
      </div></section>
      <section id="how-it-works" className="marketing-steps"><div className="marketing-container marketing-steps-grid">
        <div><p className="marketing-section-kicker">A WORKFLOW THAT MAKES SENSE</p><h2>From the work you do to the document you send.</h2><p>Keep control at every step. Velnu organizes the details, and you make the final call.</p><a href="/auth?mode=signup" className="marketing-inline-link">Explore the private beta <span>↗</span></a></div>
        <div className="marketing-steps-list">
          <article><span>01</span><div><h3>Set up your company once</h3><p>Add your business name, contact details, logo, and optional services and team context.</p></div></article>
          <article><span>02</span><div><h3>Capture the job</h3><p>Choose a customer, enter line items, or dictate a draft request when voice tools are available.</p></div></article>
          <article><span>03</span><div><h3>Review the finished document</h3><p>Check prices, taxes, scope and branded layout. You approve what gets saved or shared.</p></div></article>
        </div>
      </div></section>
      <section id="pricing" className="marketing-pricing"><div className="marketing-container">
        <div className="marketing-centered-intro"><p className="marketing-section-kicker">SIMPLE PLANS. CLEAR OPTIONS.</p><h2>A plan for where you are today.</h2><p>Start with the essentials. Unlock AI capabilities as Velnu grows. Basic and Pro pricing will be announced before paid plans launch.</p></div>
        <div className="marketing-price-grid">{plans.map(plan=><article className={'marketing-price-card' + (plan.featured?' featured':'')} key={plan.name}>
          <div className="marketing-price-top">{plan.featured&&<div className="marketing-plan-pill">AI-assisted · Planned</div>}<h3>{plan.name}</h3><p>{plan.kicker}</p><div className="marketing-price-value">{plan.price}</div><span className="marketing-price-detail">{plan.detail}</span></div>
          <ul>{plan.features.map(f=><li key={f}><span className="marketing-check">✓</span>{f}</li>)}</ul>
          <a className={'marketing-btn ' + (plan.featured?'marketing-btn-accent':'marketing-btn-outline')} href="/auth?mode=signup">{plan.name==='Free'?'Join free private beta':'Explore in private beta'} <span>↗</span></a>
        </article>)}</div>
        <p className="marketing-pricing-note">Plan features are proposed, not a guarantee of live access. No payment, subscription or automatic upgrade is activated by registering for the beta. Optional QuickBooks Online connectivity requires an eligible Intuit account; Intuit subscriptions, payment processing and other integration fees may apply separately.</p>
      </div></section>
      <section className="marketing-faq"><div className="marketing-container marketing-faq-grid"><div><p className="marketing-section-kicker">GOOD QUESTIONS</p><h2>Before you jump in.</h2><p>Clear expectations matter. Here is what to know about Velnu’s private preview.</p></div><div>{questions.map((item,i)=><div key={item.q} className="marketing-faq-item"><button type="button" aria-expanded={openFaq===i} onClick={()=>setOpenFaq(openFaq===i?null:i)}><span>{item.q}</span><b>{openFaq===i?'−':'+'}</b></button>{openFaq===i&&<p>{item.a}</p>}</div>)}</div></div></section>
      <section className="marketing-last"><div className="marketing-container marketing-last-card"><div><p className="marketing-section-kicker">YOUR OFFICE, WITHOUT THE OVERHEAD</p><h2>Make more time for the work that matters.</h2><p>Build professional documents, stay organized, and discover a simpler workflow with Velnu.</p></div><a href="/auth?mode=signup" className="marketing-btn marketing-btn-accent">Join the private beta <span>↗</span></a></div></section>
    </main>
    <footer className="marketing-footer"><div className="marketing-container marketing-footer-inner"><div><a className="marketing-brand" href="/"><span className="marketing-logo">V</span><strong>velnu<span className="brand-dot">.</span></strong></a><p>Less paperwork. More possibility.</p><small>© {new Date().getFullYear()} Velnu. Private preview.</small></div><nav aria-label="Footer links"><a href="#features">Features</a><a href="#pricing">Pricing</a><a href="/auth?mode=signin">Sign in</a><a href="/terms">User agreement</a><a href="/privacy">Privacy notice</a></nav></div></footer>
  </div>
}

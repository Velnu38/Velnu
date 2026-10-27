import { useState } from 'react'
import { monthlyPlans, addOnCatalog, assistantAddOns, assistantMonthlyTotal, formatMonthlyPrice, formatMoney } from '../lib/pricing'

const offerCards = [
  { eyebrow: '01 · Start simple', title: 'Look professional from the first estimate.', copy: 'Set up your company details, colors and logo once. Carry your identity into invoices and estimates.', kind: 'Available in private beta', icon: '◫' },
  { eyebrow: '02 · Keep work organized', title: 'Customers, jobs and schedules together.', copy: 'Keep the people, work and follow-up connected so information does not get lost between calls.', kind: 'Available in private beta', icon: '◇' },
  { eyebrow: '03 · AI OFFICE ASSISTANT', title: 'Speak it. Review it. Save a draft.', copy: 'Paid AI assistant: transcribe voice, prepare invoice and estimate drafts, identify missing details, and let you approve every action.', kind: 'AI · Basic / Pro planned', icon: '◎' },
  { eyebrow: '04 · Keep financial records clear', title: 'Know what’s paid. Know what’s spent.', copy: 'Your Bookkeeping workbook pulls in recorded invoice payments and lets you track expenses. An optional QuickBooks Online import is being tested.', kind: 'Workbook in beta · Intuit setup pending', icon: '↗' },
  { eyebrow: '05 · Put the customer first', title: 'Professional estimate review and approval.', copy: 'Let customers examine scope, totals and terms before explicitly accepting a quote.', kind: 'Customer delivery coming soon', icon: '✓' },
  { eyebrow: '06 · AI OFFICE ASSISTANT', title: 'An assistant that knows your business.', copy: 'Planned paid AI tools can use your services, territory, team roles and existing records to help find jobs, summarize unpaid invoices, and prepare follow-ups.', kind: 'AI · Basic / Pro planned', icon: '✳' },
]
const plans = [
  { name: 'Free', kicker: 'Start with the essentials', price: 'Free', detail: '10 invoices and estimates combined each month.', featured: false, features: monthlyPlans.free.features },
  { name: 'Basic', kicker: 'Affordable AI-assisted everyday work', price: formatMonthlyPrice('basic'), detail: 'Per month · Proposed pricing, not available for checkout.', featured: true, features: monthlyPlans.basic.features },
  { name: 'Pro', kicker: 'Expanded assistance for growing teams', price: formatMonthlyPrice('pro'), detail: 'Per month · Proposed pricing, not available for checkout.', featured: false, features: monthlyPlans.pro.features },
]

const questions = [
  { q: 'Does Free include AI or online customer approvals?', a: 'No. Free offers manual business tools only: zero AI calls, zero cloud transcription, zero online customer estimate acceptances, and no metered email, SMS or paid integrations. You can print a document and deliver it yourself outside Velnu.' },
  { q: 'What does the Velnu AI assistant do?', a: 'The paid AI assistant is planned to turn speech into reviewed invoice and estimate drafts, help find customers and jobs, summarize outstanding invoices, and use your business profile for context. It does not automatically send invoices or make financial decisions.' },
  { q: 'Will Velnu send an invoice without me approving it?', a: 'No. The workflow is designed around owner review. Voice and AI can prepare drafts, but customer-facing actions require your confirmation.' },
  { q: 'Is Velnu ready for my entire business?', a: 'Velnu is a private beta. Some features and integrations, including live customer email delivery, are still being tested. Keep independent copies of important records.' },
  { q: 'What do Basic, Pro and extra AI credits cost?', a: 'Proposed monthly prices: Free $0, Basic $9.99, and Pro $24.99. Extra AI credits and storage are optional. Scheduling Assistant and Bookkeeping Assistant have separate proposed monthly rates on Basic and Pro. Nothing is billed in the private beta.' },
]

export default function LandingPage() {
  const [openFaq, setOpenFaq] = useState<number | null>(0)
  return <div className="marketing-page">
    <header className="marketing-topbar">
      <div className="marketing-container marketing-nav">
        <a className="marketing-brand" href="/" aria-label="Velnu home"><span className="marketing-logo">V</span><strong>velnu<span className="brand-dot">.</span></strong></a>
        <nav aria-label="Main navigation" className="marketing-main-nav"><a href="#features">Features</a><a href="#ai-assistant">AI assistant</a><a href="/services">À la carte</a><a href="#how-it-works">How it works</a><a href="#pricing">Pricing</a></nav>
        <div className="marketing-nav-actions"><a className="marketing-signin" href="/auth?mode=signin&next=plans">Sign in · Select tier</a><a className="marketing-btn marketing-btn-dark marketing-btn-small" href="/auth?mode=signup">Join private beta <span aria-hidden="true">↗</span></a></div>
      </div>
    </header>
    <main>
      <section className="marketing-hero">
        <div className="marketing-container marketing-hero-grid">
          <div className="marketing-hero-copy">
            <div className="marketing-beta"><span className="marketing-live-dot" /> Built for the owner who does it all · Private beta</div>
            <h1>Your work. <em>Less paperwork.</em></h1>
            <p className="marketing-hero-lead">Meet Velnu, the business workspace that helps you turn everyday work into professional estimates and invoices—without a complicated back office.</p>
            <div className="marketing-hero-actions"><a href="/auth?mode=signup" className="marketing-btn marketing-btn-accent">Get started with Velnu <span>↗</span></a><a href="/auth?mode=signin&next=plans" className="marketing-watch">Sign in and choose your plan <span aria-hidden="true">↗</span></a></div>
            <p className="marketing-hero-fine">No download required. Use Velnu on your phone or computer, or <a href="/install">add it to your Home Screen</a>. No pricing commitment during the private beta.</p>
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
        <div className="marketing-section-intro"><div><p className="marketing-section-kicker">THE TOOLS THAT MATTER</p><h2>Run the work.<br /><span>Not the paperwork.</span></h2></div><p>Free covers manual business tools. The paid AI office assistant is planned for Basic and Pro, with account-based usage limits and owner review.</p></div>
        <div className="marketing-features-grid">{offerCards.map(feature=><article key={feature.eyebrow} className="marketing-feature-card"><div className="marketing-feature-top"><span className="marketing-feature-icon">{feature.icon}</span><span>{feature.kind}</span></div><p className="marketing-section-kicker">{feature.eyebrow}</p><h3>{feature.title}</h3><p>{feature.copy}</p></article>)}</div>
      </div></section>

      <section id="ai-assistant" className="marketing-assistant-spotlight">
        <div className="marketing-container marketing-ai-grid">
          <div>
            <p className="marketing-section-kicker">MEET YOUR AI OFFICE ASSISTANT</p>
            <h2>Another set of hands. <span>Not another employee.</span></h2>
            <p className="marketing-ai-lead">In Basic and Pro, Velnu's planned AI assistant helps you do the paperwork after the actual work. It uses your instructions and permitted company data to prepare answers and drafts for you to review.</p>
            <p className="marketing-ai-status"><strong>Paid capability · In testing.</strong> AI is not included in Free. Usage allowances will be set before paid plans launch.</p>
          </div>
          <div className="marketing-ai-examples">
            <article><strong>01 / Dictate an invoice</strong><p>“Create an invoice for Taylor for $185 for faucet repair.”</p><small>AI transcribes the request, prepares a line item, then asks the owner to review the customer, price and tax.</small></article>
            <article><strong>02 / Prepare an estimate</strong><p>“Draft an estimate for a water heater replacement.”</p><small>AI helps structure the quote and asks for missing quantities and prices instead of inventing them.</small></article>
            <article><strong>03 / Find answers</strong><p>“Which customers have unpaid invoices?”</p><small>AI can look up authorized records and summarize what needs attention.</small></article>
            <article><strong>04 / Know your business</strong><p>“Show my jobs scheduled this week.”</p><small>Future AI features can reference service areas, team responsibilities, and your approved business records.</small></article>
          </div>
        </div>
      </section>
      <section id="how-it-works" className="marketing-steps"><div className="marketing-container marketing-steps-grid">
        <div><p className="marketing-section-kicker">A WORKFLOW THAT MAKES SENSE</p><h2>From the work you do to the document you send.</h2><p>Keep control at every step. Velnu organizes the details, and you make the final call.</p><a href="/auth?mode=signup" className="marketing-inline-link">Explore the private beta <span>↗</span></a></div>
        <div className="marketing-steps-list">
          <article><span>01</span><div><h3>Set up your company once</h3><p>Add your business name, contact details, logo, and optional services and team context.</p></div></article>
          <article><span>02</span><div><h3>Capture the job</h3><p>Choose a customer, enter line items, or dictate a draft request when voice tools are available.</p></div></article>
          <article><span>03</span><div><h3>Review the finished document</h3><p>Check prices, taxes, scope and branded layout. You approve what gets saved or shared.</p></div></article>
        </div>
      </div></section>
      <section id="pricing" className="marketing-pricing"><div className="marketing-container">
        <div className="marketing-centered-intro"><p className="marketing-section-kicker">SIMPLE PLANS. CLEAR OPTIONS.</p><h2>A plan for where you are today.</h2><p>Start with the essentials. Unlock AI capabilities as Velnu grows. Proposed monthly plans: Free $0, Basic $9.99 and Pro $24.99. Paid plans and add-ons are not available for purchase during the private beta.</p></div>
        <div className="marketing-price-grid">{plans.map(plan=><article className={'marketing-price-card' + (plan.featured?' featured':'')} key={plan.name}>
          <div className="marketing-price-top">{plan.featured&&<div className="marketing-plan-pill">AI-assisted · Planned</div>}<h3>{plan.name}</h3><p>{plan.kicker}</p><div className="marketing-price-value">{plan.price}</div><span className="marketing-price-detail">{plan.detail}</span></div>
          <ul>{plan.features.map(f=><li key={f}><span className="marketing-check">✓</span>{f}</li>)}</ul>
          <a className={'marketing-btn ' + (plan.featured?'marketing-btn-accent':'marketing-btn-outline')} href="/auth?mode=signup">{plan.name==='Free'?'Join free private beta':'Explore in private beta'} <span>↗</span></a>
        </article>)}</div>
        <section className="marketing-assistant-pricing" aria-label="Optional Scheduling and Bookkeeping Assistant monthly prices">
          <div className="marketing-topups-header">
            <p className="marketing-section-kicker">CHOOSE YOUR ASSISTANTS</p>
            <h3>Only pay for the extra help you need.</h3>
            <p>Every Velnu workspace includes its core calendar and manual bookkeeping workbook. Add AI-powered assistance to Basic or Pro when those capabilities launch. No automatic scheduling, tax filing, payroll or full-service accounting is included.</p>
          </div>
          <div className="marketing-assistant-price-table-wrap">
            <table className="marketing-assistant-price-table">
              <thead><tr><th scope="col">Optional add-on</th><th scope="col">Basic / month</th><th scope="col">Pro / month</th></tr></thead>
              <tbody>
                {assistantAddOns.map(item => <tr key={item.id}>
                  <th scope="row"><strong>{item.name}</strong><small>{item.summary}</small></th>
                  <td>{formatMoney(item.priceMonthlyByTier.basic)}</td>
                  <td>{formatMoney(item.priceMonthlyByTier.pro)}</td>
                </tr>)}
                <tr className="marketing-assistant-total"><th scope="row">Both assistants <small>Add-on subtotal, excluding base plan</small></th><td>{formatMoney(assistantMonthlyTotal('basic', assistantAddOns.map(item => item.id)))}</td><td>{formatMoney(assistantMonthlyTotal('pro', assistantAddOns.map(item => item.id)))}</td></tr>
              </tbody>
            </table>
          </div>
          <p className="marketing-pricing-note">All assistant upgrades are proposed and not available for activation or checkout. A separate subscription to QuickBooks Online may be required for Intuit-connected functionality; Velnu is not a replacement for a licensed bookkeeper or accountant.</p>
          <a href="/services" className="marketing-inline-link">Choose optional services <span>↗</span></a>
        </section>
        <section className="marketing-topups" aria-label="Optional AI credit and storage packs">
          <div className="marketing-topups-header"><h3>Need a little more? Add usage when you need it.</h3><p>Instead of paying for a higher plan every month, choose extra Velnu AI credits or storage. Add-on billing is planned, not active.</p></div>
          <div className="marketing-topups-grid">{addOnCatalog.map(addon =>
            <article key={addon.id} className="marketing-topup-card">
              <strong>{addon.quantityLabel}</strong><span>{formatMoney(addon.priceUsd)} / {addon.billing === 'one-time' ? 'pack' : 'month'}</span>
              <p>{addon.description}</p>
            </article>
          )}</div>
          <a href="/services" className="marketing-inline-link">Explore à-la-carte options <span>↗</span></a>
        </section>
        <p className="marketing-pricing-note"><a href="/auth?mode=signin&next=plans">Already have an account? Sign in to choose Free, Basic, or Pro.</a> Free: 0 online customer acceptances and 0 metered AI, email, SMS or payment-service actions. Basic/Pro features and add-on allowances are proposed, not a guarantee of live access. No payment, subscription or automatic upgrade is activated by registering for the beta. Optional QuickBooks Online connectivity requires an eligible Intuit account; Intuit subscriptions, payment processing and other integration fees may apply separately.</p>
      </div></section>
      <section className="services-marketing-banner">
        <div className="marketing-container services-marketing-banner-inner">
          <div><p className="marketing-section-kicker">BUILD YOUR OWN TOOLKIT</p><h2>Want just the features you need?</h2><p>Choose optional capabilities à la carte, or tell us which future plan fits your business. No payment details or commitment required in the beta.</p></div>
          <a className="marketing-btn marketing-btn-dark" href="/services">Explore à la carte services <span>↗</span></a>
        </div>
      </section>
      <section className="marketing-faq"><div className="marketing-container marketing-faq-grid"><div><p className="marketing-section-kicker">GOOD QUESTIONS</p><h2>Before you jump in.</h2><p>Clear expectations matter. Here is what to know about Velnu’s private preview.</p></div><div>{questions.map((item,i)=><div key={item.q} className="marketing-faq-item"><button type="button" aria-expanded={openFaq===i} onClick={()=>setOpenFaq(openFaq===i?null:i)}><span>{item.q}</span><b>{openFaq===i?'−':'+'}</b></button>{openFaq===i&&<p>{item.a}</p>}</div>)}</div></div></section>
      <section className="marketing-last"><div className="marketing-container marketing-last-card"><div><p className="marketing-section-kicker">YOUR OFFICE, WITHOUT THE OVERHEAD</p><h2>Make more time for the work that matters.</h2><p>Build professional documents, stay organized, and discover a simpler workflow with Velnu.</p></div><a href="/auth?mode=signup" className="marketing-btn marketing-btn-accent">Join the private beta <span>↗</span></a></div></section>
    </main>
    <footer className="marketing-footer"><div className="marketing-container marketing-footer-inner"><div><a className="marketing-brand" href="/"><span className="marketing-logo">V</span><strong>velnu<span className="brand-dot">.</span></strong></a><p>Less paperwork. More possibility.</p><small>© {new Date().getFullYear()} Velnu. Private preview.</small></div><nav aria-label="Footer links"><a href="#features">Features</a><a href="#ai-assistant">AI assistant</a><a href="#pricing">Pricing</a><a href="/services">À la carte</a><a href="/install">Use the web app</a><a href="/auth?mode=signin">Sign in</a><a href="/legal">User agreement, AI and privacy</a></nav></div></footer>
  </div>
}

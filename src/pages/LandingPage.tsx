import { useState } from 'react'

const offerCards = [
  { eyebrow: '01 · Start simple', title: 'Look professional from the first estimate.', copy: 'Set up your company details, colors and logo once. Carry your identity into invoices and estimates.', kind: 'Available in private beta', icon: '◫' },
  { eyebrow: '02 · Keep work organized', title: 'Customers, jobs and schedules together.', copy: 'Keep the people, work and follow-up connected so information does not get lost between calls.', kind: 'Available in private beta', icon: '◇' },
  { eyebrow: '03 · AI OFFICE ASSISTANT', title: 'Speak it. Review it. Save a draft.', copy: 'AI assistant: transcribe voice, prepare invoice and estimate drafts, identify missing details, and let you approve every action.', kind: 'AI assistant · In private testing', icon: '◎' },
  { eyebrow: '04 · Keep financial records clear', title: 'Know what’s paid. Know what’s spent.', copy: 'Your Bookkeeping workbook pulls in recorded invoice payments and lets you track expenses. An optional QuickBooks Online import is being tested.', kind: 'Workbook in beta · Intuit setup pending', icon: '↗' },
  { eyebrow: '05 · Put the customer first', title: 'Professional estimate review and approval.', copy: 'Let customers examine scope, totals and terms before explicitly accepting a quote.', kind: 'Customer delivery coming soon', icon: '✓' },
  { eyebrow: '06 · AI OFFICE ASSISTANT', title: 'An assistant that knows your business.', copy: 'Planned AI tools can use your services, territory, team roles and existing records to help find jobs, summarize unpaid invoices, and prepare follow-ups.', kind: 'AI assistant · In private testing', icon: '✳' },
]
const questions = [
  { q: 'What does the Finviant Office AI assistant do?', a: 'The AI assistant is planned to turn speech into reviewed invoice and estimate drafts, help find customers and jobs, summarize outstanding invoices, and use your business profile for context. It does not automatically send invoices or make financial decisions.' },
  { q: 'Will Finviant Office send an invoice without me approving it?', a: 'No. The workflow is designed around owner review. Voice and AI can prepare drafts, but customer-facing actions require your confirmation.' },
  { q: 'Is Finviant Office ready for my entire business?', a: 'Finviant Office is a private beta. Some features and integrations, including live customer email delivery, are still being tested. Keep independent copies of important records.' },
]

export default function LandingPage() {
  const [openFaq, setOpenFaq] = useState<number | null>(0)
  return <div className="marketing-page">
    <header className="marketing-topbar">
      <div className="marketing-container marketing-nav">
        <a className="marketing-brand" href="/" aria-label="Finviant Office home"><span className="marketing-logo"><img src="/finviant-mark.svg" alt="" /></span><strong>Finviant<span className="brand-dot">.</span></strong></a>
        <nav aria-label="Main navigation" className="marketing-main-nav"><a href="#features">Features</a><a href="#ai-assistant">AI assistant</a><a href="#how-it-works">How it works</a></nav>
        <div className="marketing-nav-actions"><a className="marketing-signin" href="/auth?mode=signin">Sign in</a><a className="marketing-btn marketing-btn-dark marketing-btn-small" href="/auth?mode=signup">Join private beta <span aria-hidden="true">↗</span></a></div>
      </div>
    </header>
    <main>
      <section className="marketing-hero">
        <div className="marketing-container marketing-hero-grid">
          <div className="marketing-hero-copy">
            <div className="marketing-beta"><span className="marketing-live-dot" /> Built for the owner who does it all · Private beta</div>
            <h1>Your work. <em>Less paperwork.</em></h1>
            <p className="marketing-hero-lead">Meet Finviant Office, the business workspace that helps you turn everyday work into professional estimates and invoices—without a complicated back office.</p>
            <div className="marketing-hero-actions"><a href="/auth?mode=signup" className="marketing-btn marketing-btn-accent">Get started with Finviant Office <span>↗</span></a><a href="/auth?mode=signin" className="marketing-watch">Sign in to your test workspace <span aria-hidden="true">↗</span></a></div>
            <p className="marketing-hero-fine">No download required. Use Finviant Office on your phone or computer, or <a href="/install">add it to your Home Screen</a>. No pricing commitment during the private beta.</p>
            <div className="marketing-hero-statline"><span><strong>One place</strong> for customers and jobs</span><span><strong>Your brand</strong> on every document</span><span><strong>Your review</strong> before anything goes out</span></div>
          </div>
          <div className="marketing-scene" role="img" aria-label="Illustrative Finviant Office interface showing a spoken request, an invoice draft, and company branding">
            <div className="marketing-orbit marketing-orbit-one" /><div className="marketing-orbit marketing-orbit-two" />
            <div className="marketing-float-label">A clearer way to work.</div>
            <div className="marketing-demo-window">
              <div className="marketing-demo-header"><div className="marketing-demo-brand"><span className="marketing-logo"><img src="/finviant-mark.svg" alt="" /></span><strong>Finviant</strong><span>Office</span></div><div className="marketing-demo-dots"><i /><i /><i /></div></div>
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
        <div className="marketing-section-intro"><div><p className="marketing-section-kicker">THE TOOLS THAT MATTER</p><h2>Run the work.<br /><span>Not the paperwork.</span></h2></div><p>Finviant Office is in private testing. AI-assisted features are limited and may change as testing continues.</p></div>
        <div className="marketing-features-grid">{offerCards.map(feature=><article key={feature.eyebrow} className="marketing-feature-card"><div className="marketing-feature-top"><span className="marketing-feature-icon">{feature.icon}</span><span>{feature.kind}</span></div><p className="marketing-section-kicker">{feature.eyebrow}</p><h3>{feature.title}</h3><p>{feature.copy}</p></article>)}</div>
      </div></section>

      <section id="ai-assistant" className="marketing-assistant-spotlight">
        <div className="marketing-container marketing-ai-grid">
          <div>
            <p className="marketing-section-kicker">MEET YOUR AI OFFICE ASSISTANT</p>
            <h2>Another set of hands. <span>Not another employee.</span></h2>
            <p className="marketing-ai-lead">Finviant Office's planned AI assistant helps you do the paperwork after the actual work. It uses your instructions and permitted company data to prepare answers and drafts for you to review.</p>
            <p className="marketing-ai-status"><strong>In testing.</strong> AI features are limited to approved test access and may change.</p>
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
        <div><p className="marketing-section-kicker">A WORKFLOW THAT MAKES SENSE</p><h2>From the work you do to the document you send.</h2><p>Keep control at every step. Finviant Office organizes the details, and you make the final call.</p><a href="/auth?mode=signup" className="marketing-inline-link">Explore the private beta <span>↗</span></a></div>
        <div className="marketing-steps-list">
          <article><span>01</span><div><h3>Set up your company once</h3><p>Add your business name, contact details, logo, and optional services and team context.</p></div></article>
          <article><span>02</span><div><h3>Capture the job</h3><p>Choose a customer, enter line items, or dictate a draft request when voice tools are available.</p></div></article>
          <article><span>03</span><div><h3>Review the finished document</h3><p>Check prices, taxes, scope and branded layout. You approve what gets saved or shared.</p></div></article>
        </div>
      </div></section>
      <section className="services-marketing-banner">
        <div className="marketing-container services-marketing-banner-inner">
          <div><p className="marketing-section-kicker">PRIVATE TESTING</p><h2>Test Finviant Office before public beta.</h2><p>No subscription or charges are active. Test data, including account and business records, may be changed, reset, or deleted without notice. Use fictional or nonessential information and keep your own copies of anything important.</p></div>
        </div>
      </section>
      <section className="marketing-faq"><div className="marketing-container marketing-faq-grid"><div><p className="marketing-section-kicker">GOOD QUESTIONS</p><h2>Before you jump in.</h2><p>Clear expectations matter. Here is what to know about Finviant Office’s private preview.</p></div><div>{questions.map((item,i)=><div key={item.q} className="marketing-faq-item"><button type="button" aria-expanded={openFaq===i} onClick={()=>setOpenFaq(openFaq===i?null:i)}><span>{item.q}</span><b>{openFaq===i?'−':'+'}</b></button>{openFaq===i&&<p>{item.a}</p>}</div>)}</div></div></section>
      <section className="marketing-last"><div className="marketing-container marketing-last-card"><div><p className="marketing-section-kicker">YOUR OFFICE, WITHOUT THE OVERHEAD</p><h2>Make more time for the work that matters.</h2><p>Build professional documents, stay organized, and discover a simpler workflow with Finviant Office.</p></div><a href="/auth?mode=signup" className="marketing-btn marketing-btn-accent">Join the private beta <span>↗</span></a></div></section>
    </main>
    <footer className="marketing-footer"><div className="marketing-container marketing-footer-inner"><div><a className="marketing-brand" href="/"><span className="marketing-logo"><img src="/finviant-mark.svg" alt="" /></span><strong>Finviant<span className="brand-dot">.</span></strong></a><p>Less paperwork. More possibility.</p><small>© {new Date().getFullYear()} Finviant Office. Private preview.</small></div><nav aria-label="Footer links"><a href="#features">Features</a><a href="#ai-assistant">AI assistant</a><a href="/install">Use the web app</a><a href="/auth?mode=signin">Sign in</a><a href="/legal">User agreement, AI and privacy</a></nav></div></footer>
  </div>
}

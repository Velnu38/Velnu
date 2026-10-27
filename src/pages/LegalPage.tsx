import { AGREEMENT_EFFECTIVE_DATE, AGREEMENT_VERSION, agreementSections } from '../legal/agreement'

export default function LegalPage() {
  return <main className="legal-public-page">
    <nav className="legal-nav"><a className="marketing-brand" href="/"><span className="marketing-logo">V</span><strong>Velnu</strong></a><a href="/">Back to home</a></nav>
    <article className="legal-paper">
      <p className="eyebrow">Private preview · Legal review pending</p>
      <h1>Velnu User Agreement, AI Disclosure & Privacy Notice</h1>
      <p className="legal-meta">Single combined agreement · Version {AGREEMENT_VERSION} · Effective {AGREEMENT_EFFECTIVE_DATE}</p>
      <p className="legal-disclaimer">This is a preliminary business-facing agreement for private testing. Its liability provisions do not guarantee protection against lawsuits. Before public launch, Velnu’s verified legal operator, contact details, privacy disclosures and jurisdiction-specific terms must be finalized and reviewed by qualified legal counsel.</p>
      <nav aria-label="Sections of agreement" className="legal-section-links"><a href="#legal-terms">Business user terms</a><a href="#legal-privacy">Privacy and data handling</a></nav>
      <section id="legal-terms" className="legal-chapter"><h2>Part I · Business user terms and AI disclosure</h2></section>
      {agreementSections.map((section, i) => <section key={section.title} id={i === 12 ? 'legal-privacy' : undefined} className="legal-section">
        {i === 12 && <h2 className="legal-chapter-title">Part II · Privacy and data handling</h2>}
        <h3>{section.title}</h3>{section.paragraphs.map((p,j) => <p key={j}>{p}</p>)}
      </section>)}
      <div className="legal-bottom-links"><a href="#legal-terms">Business terms</a><a href="#legal-privacy">Privacy section</a><a href="/auth?mode=signin&next=plans">Sign in and choose a plan</a></div>
    </article>
  </main>
}

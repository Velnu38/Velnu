import { AGREEMENT_EFFECTIVE_DATE, AGREEMENT_VERSION, privacySections, termsSections } from '../legal/agreement'

export default function LegalPage({ variant = 'terms' }: { variant?: 'terms' | 'privacy' }) {
  const terms = variant === 'terms'
  const sections = terms ? termsSections : privacySections
  return <main className="legal-public-page">
    <nav className="legal-nav"><a className="marketing-brand" href="/"><span className="marketing-logo">V</span><strong>Velnu</strong></a><a href="/">Back to home</a></nav>
    <article className="legal-paper">
      <p className="eyebrow">Private preview · Legal review pending</p>
      <h1>{terms ? 'Velnu Business User Agreement' : 'Velnu Privacy Notice'}</h1>
      <p className="legal-meta">{terms ? 'Version ' + AGREEMENT_VERSION + ' · Effective ' + AGREEMENT_EFFECTIVE_DATE : 'Preview notice · Updated ' + AGREEMENT_EFFECTIVE_DATE}</p>
      <p className="legal-disclaimer">These materials are preliminary business-facing drafts for the Velnu private test. Before public launch, the operator’s full legal identity, support contact, privacy practices, and jurisdiction-specific provisions must be completed and reviewed by qualified counsel.</p>
      {sections.map(section => <section key={section.title} className="legal-section">
        <h2>{section.title}</h2>{section.paragraphs.map((p,i)=><p key={i}>{p}</p>)}
      </section>)}
      <div className="legal-bottom-links"><a href="/terms">User agreement</a><a href="/privacy">Privacy notice</a><a href="/auth?mode=signup">Create account</a></div>
    </article>
  </main>
}

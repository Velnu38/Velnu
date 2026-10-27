export default function InstallPage() {
  return <main className="install-public-page">
    <header className="services-public-nav">
      <a href="/" className="marketing-brand"><span className="marketing-logo">V</span><strong>velnu<span className="brand-dot">.</span></strong></a>
      <nav><a href="/">Home</a><a href="/services">Services</a><a href="/auth?mode=signin">Sign in</a></nav>
    </header>
    <section className="install-hero">
      <p className="marketing-section-kicker">THE WEBSITE IS THE APP</p>
      <h1>One Velnu account. <em>Any screen.</em></h1>
      <p>There's nothing to download to use Velnu. Sign in through your browser on an iPhone, Android phone, tablet, or computer. The same cloud-backed business records and features follow your account.</p>
      <div className="install-actions"><a href="/auth?mode=signin" className="marketing-btn marketing-btn-accent">Open Velnu web app <span>↗</span></a><a href="/auth?mode=signup" className="marketing-btn marketing-btn-outline">Create a free beta account <span>↗</span></a></div>
      <div className="install-guide-grid">
        <article><span className="install-device-icon">◉</span><h2>iPhone / iPad</h2><p>In Safari, open Velnu, tap the Share option (or Page Menu → Share), choose <strong>Add to Home Screen</strong>, keep <strong>Open as Web App</strong> selected, and tap Add.</p></article>
        <article><span className="install-device-icon">▣</span><h2>Android</h2><p>Open Velnu in Chrome and use the browser menu to choose <strong>Add to Home screen</strong> or <strong>Install app</strong>, if that option is offered.</p></article>
        <article><span className="install-device-icon">▤</span><h2>Computer</h2><p>Visit the Velnu website and click <strong>Open Velnu web app</strong>. There's no separate desktop software required.</p></article>
      </div>
      <p className="install-help">A Home Screen icon opens the same web app—it is not an App Store download. Internet access is required for most Velnu functions. Some beta integrations are not yet available.</p>
    </section>
  </main>
}

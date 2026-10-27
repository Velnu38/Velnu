export default function PlaceholderPage({ title, description }: { title: string; description: string }) {
  return (
    <div className="page-stack">
      <div className="page-heading"><div><p className="eyebrow">{title}</p><h1>{description}</h1></div></div>
      <section className="empty-module"><div className="empty-icon">O</div><h2>{title} is next in the build.</h2><p>The database foundation is already in place. This screen will use the same live Finviant Office data as mobile and desktop.</p></section>
    </div>
  )
}

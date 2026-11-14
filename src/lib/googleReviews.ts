export function normalizeGoogleReviewUrl(value: string): string | null {
  if (!value.trim()) return null
  const invalid = () => new Error('Paste the review link copied from Google Business Profile → Get more reviews.')
  let url: URL
  try { url = new URL(value.trim()) } catch { throw invalid() }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) throw invalid()
  if (url.hostname === 'g.page' && /^\/(?:r\/)?[A-Za-z0-9_-]{1,220}\/review\/?$/.test(url.pathname)) {
    return url.origin + url.pathname.replace(/\/$/, '')
  }
  const place = url.searchParams.get('placeid')
  if (url.hostname === 'search.google.com' && url.pathname === '/local/writereview' && place && /^[A-Za-z0-9_-]{1,220}$/.test(place)) {
    return url.origin + url.pathname + '?placeid=' + place
  }
  throw invalid()
}

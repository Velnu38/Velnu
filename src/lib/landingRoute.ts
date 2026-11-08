/** The public website must render without waiting for a workspace session.
 * Explicit app, customer, invitation and authentication links keep their flow.
 */
export function isLandingRoute(pathname: string, search: string, hash: string): boolean {
  const query = new URLSearchParams(search)
  const fragment = new URLSearchParams(hash.replace(/^#/, ''))
  if (['approval', 'booking', 'document_share', 'invite', 'recovery', 'code', 'error'].some(key => query.has(key))) return false
  if (['access_token', 'refresh_token', 'type', 'error', 'error_code'].some(key => fragment.has(key))) return false
  if (pathname === '/services') return true
  return ['/', '/index.html'].includes(pathname)
    && !['view', 'mode', 'next'].some(key => query.has(key))
}

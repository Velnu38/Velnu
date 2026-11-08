/** Hosted account emails always return to the owned domain, never an ephemeral preview. */
export function authRedirect(path = 'auth'): string {
  const origin = ['localhost', '127.0.0.1'].includes(window.location.hostname) ? window.location.origin : 'https://finviant.com'
  return `${origin}/${path}`
}
export function passwordError(password: string): string | null {
  if (Array.from(password).length < 15) return 'Use at least 15 characters. A unique passphrase is a good choice.'
  if (new TextEncoder().encode(password).length > 72) return 'Use a password of at most 72 UTF-8 bytes (some symbols use multiple bytes).'
  return null
}
export function authMessage(error: unknown, mode: string): string {
  const e = error as {code?: string; message?: string; status?: number}
  if (e?.status === 429 || /rate.limit|too many|only request this after/i.test(e?.message || '')) return 'Too many attempts. Wait a little before trying again; check the newest email already sent.'
  if (e?.code === 'email_not_confirmed') return 'Confirm your email before signing in. You can request a new confirmation email below.'
  if (e?.code === 'weak_password') return 'Choose a stronger, unique password of at least 15 characters that has not appeared in a data breach.'
  if (e?.code === 'user_already_exists' || /already registered/i.test(e?.message || '')) return 'If you registered before, sign in or use Forgot password. Creating another account will not reset your password.'
  if (mode === 'signin') return 'Unable to sign in. Check your email and password, or use Forgot password. If you just registered, check your confirmation email.'
  return 'Unable to complete this request. Check your connection and try again. If the issue continues, contact the test administrator.'
}

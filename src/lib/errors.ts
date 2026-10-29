/** Show safe messages from Error instances and structured API failures.
 * Supabase/PostgREST may return a plain object with a message field. */
export function readableError(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'message' in error) {
    const value = (error as { message?: unknown }).message
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  if (typeof error === 'string' && error.trim()) return error.trim()
  return fallback
}

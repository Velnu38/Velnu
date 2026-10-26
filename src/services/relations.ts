/** PostgREST embeds many-to-one relationships as objects, not arrays. */
export function asList<T>(value: T | T[] | null | undefined): T[] {
  if (value == null) return []
  return Array.isArray(value) ? value : [value]
}

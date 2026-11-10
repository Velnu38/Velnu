/** Presentation fallback only: never write over a company’s saved wording. */
export const DEFAULT_DOCUMENT_FOOTER = 'Thank You!'
export function documentFooter(value?: string | null): string {
  return value?.trim() ? value : DEFAULT_DOCUMENT_FOOTER
}

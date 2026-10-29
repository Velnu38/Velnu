export type QuickBooksPage<T> = {
  records: T[]
  totalCount?: number
  startPosition?: number
}

export type QuickBooksPagedResult<T> = {
  records: T[]
  limited: boolean
}

export const QUICKBOOKS_PAGE_SIZE = 100
export const QUICKBOOKS_MAX_QUERY_RESULTS = 1000

/** Fetch the bounded QuickBooks query window without silently treating a partial page as complete. */
export async function fetchQuickBooksQueryPages<T>(
  fetchPage: (startPosition: number, pageSize: number) => Promise<QuickBooksPage<T>>,
): Promise<QuickBooksPagedResult<T>> {
  const records: T[] = []
  let expectedTotal: number | null = null

  for (let startPosition = 1; startPosition <= QUICKBOOKS_MAX_QUERY_RESULTS; startPosition += QUICKBOOKS_PAGE_SIZE) {
    const page = await fetchPage(startPosition, QUICKBOOKS_PAGE_SIZE)
    if (!page || !Array.isArray(page.records) || page.records.length > QUICKBOOKS_PAGE_SIZE) {
      throw new Error('QuickBooks returned an invalid transaction page.')
    }
    if (page.startPosition !== undefined && page.startPosition !== startPosition) {
      throw new Error('QuickBooks returned a transaction page at an unexpected position.')
    }
    if (page.totalCount !== undefined) {
      if (!Number.isSafeInteger(page.totalCount) || page.totalCount < 0) {
        throw new Error('QuickBooks returned an invalid transaction count.')
      }
      if (expectedTotal !== null && page.totalCount !== expectedTotal) {
        throw new Error('QuickBooks transaction count changed during pagination. Retry the sync.')
      }
      expectedTotal = page.totalCount
    }

    records.push(...page.records)
    if (expectedTotal !== null && records.length > expectedTotal) {
      throw new Error('QuickBooks returned more transactions than its reported total.')
    }
    if (expectedTotal !== null && records.length >= expectedTotal) {
      return { records, limited: false }
    }
    if (page.records.length < QUICKBOOKS_PAGE_SIZE) {
      if (expectedTotal !== null && records.length < expectedTotal) {
        throw new Error('QuickBooks returned fewer transactions than its reported total.')
      }
      return { records, limited: false }
    }
  }

  return {
    records,
    limited: expectedTotal === null || records.length < expectedTotal,
  }
}

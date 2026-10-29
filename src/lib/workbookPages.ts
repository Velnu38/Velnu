type Page<T> = { data: T[] | null; error: { message: string } | null; count: number | null }

/** Load the complete tenant-filtered result, or fail visibly instead of
 * presenting a truncated financial total. Callers must order by immutable ID.
 * This guards count/identity changes, but is not a database snapshot export. */
export async function collectWorkbookPages<T extends { id: string }>(
  load: (from: number, to: number) => PromiseLike<Page<T>>,
): Promise<T[]> {
  const rows: T[] = [], ids = new Set<string>()
  let expected: number | undefined
  for (;;) {
    const page = await load(rows.length, rows.length + 999)
    if (page.error) throw new Error(page.error.message)
    if (page.count === null || !Number.isSafeInteger(page.count) || page.count < 0) {
      throw new Error('Unable to verify the complete workbook. Refresh and try again.')
    }
    if (page.count > 50000) throw new Error('This workbook exceeds the 50,000-entry display limit. A complete server export is required.')
    expected ??= page.count
    if (page.count !== expected) throw new Error('Workbook entries changed while loading. Refresh and try again.')
    const batch = page.data ?? []
    for (const row of batch) {
      if (ids.has(row.id)) throw new Error('Workbook entries changed while loading. Refresh and try again.')
      ids.add(row.id)
      rows.push(row)
    }
    if (rows.length === expected) return rows
    if (!batch.length || rows.length > expected) throw new Error('The workbook response is incomplete. Refresh and try again.')
  }
}

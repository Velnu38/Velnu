type Page<T> = { data: T[] | null; error: { message: string } | null; count: number | null }

/** A stable, tenant-filtered scan. Never silently accept Supabase's row cap.
 * Count or identity changes require a refresh; this is not a snapshot export. */
export async function collectBusinessRecords<T extends { id: string }>(load: (from: number, to: number) => PromiseLike<Page<T>>): Promise<T[]> {
  const rows: T[] = [], seen = new Set<string>()
  let expected: number | undefined
  for (;;) {
    const page = await load(rows.length, rows.length + 499)
    if (page.error) throw new Error(page.error.message)
    if (page.count === null || !Number.isSafeInteger(page.count) || page.count < 0 || page.count > 50000) throw new Error('Unable to verify the complete record list. Refresh or narrow your search.')
    expected ??= page.count
    if (page.count !== expected) throw new Error('Records changed while loading. Refresh and try again.')
    const batch = page.data ?? []
    for (const row of batch) {
      if (seen.has(row.id)) throw new Error('Records changed while loading. Refresh and try again.')
      seen.add(row.id); rows.push(row)
    }
    if (rows.length === expected) return rows
    if (!batch.length || rows.length > expected) throw new Error('The record list is incomplete. Refresh and try again.')
  }
}

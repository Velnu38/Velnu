import {
  fetchQuickBooksQueryPages,
  QUICKBOOKS_MAX_QUERY_RESULTS,
} from '../../supabase/functions/_shared/quickbooksQuery.ts'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

Deno.test('100 generated QuickBooks transaction sets paginate completely through 1000 records', async () => {
  for (let scenario = 0; scenario < 100; scenario++) {
    const total = 1 + scenario * 10
    const result = await fetchQuickBooksQueryPages(async (startPosition, pageSize) => ({
      startPosition,
      totalCount: total,
      records: Array.from({ length: Math.min(pageSize, Math.max(0, total - startPosition + 1)) }, (_, i) => startPosition + i),
    }))
    assert(result.records.length === total, `scenario ${scenario}: all records should be returned`)
    assert(new Set(result.records).size === total, `scenario ${scenario}: records should not repeat`)
    assert(result.limited === false, `scenario ${scenario}: complete response should not be marked limited`)
  }
})

Deno.test('100 generated QuickBooks transaction sets beyond the provider cap are marked incomplete', async () => {
  for (let scenario = 0; scenario < 100; scenario++) {
    const total = QUICKBOOKS_MAX_QUERY_RESULTS + 1 + scenario * 10
    const starts: number[] = []
    const result = await fetchQuickBooksQueryPages(async (startPosition, pageSize) => {
      starts.push(startPosition)
      return {
        startPosition,
        totalCount: total,
        records: Array.from({ length: Math.min(pageSize, Math.max(0, total - startPosition + 1)) }, (_, i) => startPosition + i),
      }
    })
    assert(result.records.length === QUICKBOOKS_MAX_QUERY_RESULTS, `scenario ${scenario}: result must stay inside the provider cap`)
    assert(result.limited === true, `scenario ${scenario}: incomplete result must be visible`)
    assert(starts.length === QUICKBOOKS_MAX_QUERY_RESULTS / 100, `scenario ${scenario}: query count must be bounded`)
  }
})

Deno.test('100 changed-count provider responses fail instead of publishing inconsistent totals', async () => {
  for (let scenario = 0; scenario < 100; scenario++) {
    let rejected = false
    try {
      await fetchQuickBooksQueryPages(async (startPosition, pageSize) => ({
        startPosition,
        totalCount: startPosition === 1 ? 150 : 151 + scenario,
        records: Array.from({ length: pageSize }, (_, i) => startPosition + i),
      }))
    } catch (error) {
      rejected = error instanceof Error && error.message.includes('count changed')
    }
    assert(rejected, `scenario ${scenario}: changing provider total must fail closed`)
  }
})

Deno.test('short and empty QuickBooks pages complete when provider totals agree', async () => {
  const empty = await fetchQuickBooksQueryPages(async startPosition => ({
    startPosition, totalCount: 0, records: [],
  }))
  assert(empty.records.length === 0 && !empty.limited, 'empty account should sync as complete')

  const short = await fetchQuickBooksQueryPages(async startPosition => ({
    startPosition, totalCount: 42,
    records: startPosition === 1 ? Array.from({ length: 42 }, (_, i) => i + 1) : [],
  }))
  assert(short.records.length === 42 && !short.limited, 'short final page should sync as complete')
})

Deno.test('inconsistent, oversized and mispositioned QuickBooks pages are rejected', async () => {
  const invalidPages = [
    async () => ({ records: Array.from({ length: 101 }, (_, i) => i) }),
    async () => ({ startPosition: 2, totalCount: 1, records: [1] }),
    async () => ({ startPosition: 1, totalCount: 200, records: Array.from({ length: 50 }, (_, i) => i + 1) }),
    async () => ({ startPosition: 1, totalCount: 0, records: [1] }),
  ]
  for (const invalidPage of invalidPages) {
    let rejected = false
    try {
      await fetchQuickBooksQueryPages(async () => await invalidPage())
    } catch {
      rejected = true
    }
    assert(rejected, 'malformed QuickBooks paging response should fail closed')
  }
})

import { collectWorkbookPages } from '../../src/lib/workbookPages.ts'

for (const size of [0, 1, 999, 1000, 1001, 2001]) {
  Deno.test('complete workbook includes ' + size + ' rows exactly once', async () => {
    const source = Array.from({ length: size }, (_, i) => ({ id: String(i), amount: 1 }))
    const result = await collectWorkbookPages((from, to) => Promise.resolve({ data: source.slice(from, to + 1), count: size, error: null }))
    if (result.length !== size || result.reduce((sum, row) => sum + row.amount, 0) !== size) throw new Error('Incomplete financial result')
  })
}
Deno.test('a server page cap below 1000 does not truncate the workbook', async () => {
  const source = Array.from({ length: 1001 }, (_, i) => ({ id: String(i) }))
  const result = await collectWorkbookPages(from => Promise.resolve({ data: source.slice(from, from + 100), count: source.length, error: null }))
  if (result.length !== 1001) throw new Error('Truncated')
})
for (const scenario of ['failure', 'missing-count', 'changed-count', 'repeated-page', 'premature-empty', 'over-limit']) {
  Deno.test('incomplete workbook fails visibly: ' + scenario, async () => {
    let calls = 0, rejected = false
    try {
      await collectWorkbookPages(() => {
        calls++
        return Promise.resolve({
          data: scenario === 'premature-empty' && calls > 1 ? [] : [{ id: 'one' }],
          count: scenario === 'missing-count' ? null : scenario === 'over-limit' ? 50001 : scenario === 'changed-count' && calls > 1 ? 3 : 2,
          error: scenario === 'failure' && calls > 1 ? { message: 'Backend unavailable' } : null,
        })
      })
    } catch { rejected = true }
    if (!rejected || calls > 2) throw new Error('Incomplete result was accepted or retries were unbounded')
  })
}

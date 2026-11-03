/** Use the dashboard entry points; legacy Schedule remains a supported deep link. */
export async function openWorkArea(page, area) {
  if (area === 'Schedule') { await page.goto('/?view=schedule'); return }
  await page.getByRole('button', { name: 'Dashboard', exact: true }).click()
  if (area === 'Bookkeeping') {
    await page.getByRole('button', { name: 'View all income & expenses', exact: true }).click()
  } else if (area === 'Jobs') {
    await page.getByRole('article', { name: 'Jobs overview' }).getByRole('button', { name: /Active jobs/ }).click()
  } else {
    await page.getByRole('article', { name: 'Estimates and invoices overview' }).getByRole('button', { name: area, exact: true }).click()
  }
}

/** Generic creation lives only in the dashboard header. */
export async function createWork(page, kind) {
  await page.getByRole('button', { name: 'Dashboard', exact: true }).click()
  await page.getByRole('navigation', { name: 'Create work' }).getByRole('link', { name: '+ New ' + kind, exact: true }).click()
}

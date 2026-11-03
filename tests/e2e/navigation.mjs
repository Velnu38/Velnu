/** Use the dashboard entry points; legacy Schedule remains a supported deep link. */
export async function openWorkArea(page, area) {
  if (area === 'Schedule') { await page.goto('/?view=schedule'); return }
  await page.getByRole('button', { name: 'Dashboard', exact: true }).click()
  if (area === 'Bookkeeping') {
    await page.getByRole('button', { name: 'Full workbook', exact: true }).click()
  } else if (area === 'Jobs') {
    await page.getByRole('article', { name: 'Jobs overview' }).getByRole('button', { name: 'Open jobs', exact: true }).click()
  } else {
    await page.getByRole('article', { name: 'Estimates and invoices overview' }).getByRole('button', { name: area, exact: true }).click()
  }
}

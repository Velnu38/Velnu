/** Follow the current dashboard work-area navigation; never bypass UI via app state. */
export async function openWorkArea(page, area) {
  await page.getByRole('button', { name: 'Dashboard', exact: true }).click()
  if (area === 'Bookkeeping') {
    await page.getByRole('button', { name: 'Open financial workbook', exact: true }).click()
  } else if (area === 'Jobs' || area === 'Schedule') {
    await page.getByRole('article', { name: 'Jobs and schedule overview' }).getByRole('button', { name: 'Jobs & schedule', exact: true }).click()
    await page.getByRole('navigation', { name: 'Jobs and schedule views' }).getByRole('button', { name: area, exact: true }).click()
  } else {
    await page.getByRole('button', { name: area, exact: true }).click()
  }
}

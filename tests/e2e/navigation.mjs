/** Use the dashboard entry points; legacy Schedule remains a supported deep link. */
export async function openWorkArea(page, area) {
  if (area === 'Schedule') { await page.goto('/?view=schedule'); return }
  await page.getByRole('button', { name: 'Home', exact: true }).click()
  if (area === 'Bookkeeping') {
    await page.getByRole('button', { name: 'View all income & expenses', exact: true }).click()
  } else {
    await page.getByRole('button', { name: area, exact: true }).click()
  }
}

/** Home groups creation in one accessible chooser. */
export async function createWork(page, kind) {
  await page.getByRole('button', { name: 'Home', exact: true }).click()
  await page.getByRole('button', { name: 'Create new', exact: true }).click()
  await page.getByRole('navigation', { name: 'Create work' }).getByRole('link', { name: '+ New ' + kind, exact: true }).click()
}

/** Ask Fin opens typing without microphone access on every viewport. */
export async function openFinTyping(page) {
  await page.locator('.fin-launcher').getByRole('button', { name: 'Ask Fin', exact: true }).click()
}

/** Request microphone access only from the explicit speaking control. */
export async function openFinVoice(page) {
  await openFinTyping(page)
  await page.getByRole('dialog', { name: 'Fin — your office assistant' }).getByRole('button', { name: 'Speak instead', exact: true }).click()
}

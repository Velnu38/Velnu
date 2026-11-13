import {expect} from '@playwright/test'
/** Use the dashboard entry points; legacy Schedule remains a supported deep link. */
export async function openWorkArea(page, area) {
  if (area === 'Schedule') { await page.goto('/?view=schedule'); return }
  await page.getByRole('button', { name: 'Home', exact: true }).click()
  if (area === 'Bookkeeping') {
    await openHomePanels(page,['finances'])
    await page.getByRole('button', { name: 'View all income & expenses', exact: true }).click()
  } else {
    await page.getByRole('button', { name: area, exact: true }).click()
  }
}

/** Home groups creation in one accessible chooser. */
export async function createWork(page, kind) {
  await page.getByRole('button', { name: 'Home', exact: true }).click()
  await page.getByRole('button', { name: 'Quick Links', exact: true }).click()
  await page.getByRole('navigation', { name: 'Create work and quick links' }).getByRole('link', { name: '+ New ' + kind, exact: true }).click()
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

/** Open the current Home cards through their visible controls before testing detailed workflows. */
export async function openHomePanels(page, panels = ['calendar','finances','billing']) {
  const home=page.locator('.home-revised')
  await home.waitFor({state:'visible'})
  const labels={calendar:/^Calendar\s*›?$/,finances:/^View finances\s*›?$/,billing:/^Invoice review/,work:/^Work blockers/}
  for(const panel of panels){
    const button=home.getByRole('button',{name:labels[panel]})
    if(await button.count()&&await button.isVisible())await button.click()
  }
}
export async function refreshHome(page){
  await page.getByRole('button',{name:'Quick Links',exact:true}).click()
  await page.getByRole('dialog',{name:'Quick Links',exact:true}).getByRole('button',{name:'Refresh Home',exact:true}).click()
  await expect(page.getByRole('button',{name:'Quick Links',exact:true})).toHaveAttribute('aria-busy','false')
}

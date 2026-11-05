import assert from 'node:assert/strict'
import test from 'node:test'
import type { CurrentBusiness } from '../../src/lib/business'
import { canOpenSettingsSection, settingsOptions, settingsHref, settingsSectionFromSearch } from '../../src/lib/settingsNavigation'
import { canOpenView } from '../../src/lib/workspaceAccess'

const business = (role: CurrentBusiness['role'], modules: string[] = [], primary = false) => ({role, access_modules: modules, primary_owner: primary}) as CurrentBusiness

test('primary owner retains setup and subscription access; private tests remain environment gated', () => {
  const owner = business('owner', [], true)
  for (const option of settingsOptions) assert.equal(canOpenSettingsSection(owner, option.id, false), option.id !== 'testing')
  assert.equal(canOpenSettingsSection(owner, 'testing', true), true)
})

test('delegated setup preserves calendar and scheduling permissions without owner privileges', () => {
  for (const role of ['owner', 'admin', 'office', 'technician', 'viewer'] as const) {
    const member = business(role, ['calendar', 'jobs', 'billing', 'finances'])
    for (const section of ['company', 'team', 'documents', 'sms', 'subscription', 'testing'] as const) assert.equal(canOpenSettingsSection(member, section, true), false, role + ':' + section)
    assert.equal(canOpenSettingsSection(member, 'support'), true)
    assert.equal(canOpenSettingsSection(member, 'calendar'), true)
    assert.equal(canOpenSettingsSection(member, 'scheduling'), ['owner', 'admin', 'office'].includes(role))
  }
})

test('calendar setup and working hours require the same modules as before', () => {
  for (const modules of [[], ['calendar'], ['jobs'], ['calendar', 'jobs']]) {
    const office = business('office', modules)
    assert.equal(canOpenSettingsSection(office, 'calendar'), modules.includes('calendar'))
    assert.equal(canOpenSettingsSection(office, 'scheduling'), modules.includes('calendar') && modules.includes('jobs'))
  }
})

test('direct setup links and SMS/testing callbacks preserve their section destinations', () => {
  for (const {id} of settingsOptions) assert.equal(settingsSectionFromSearch(settingsHref(id).slice(1)), id)
  assert.equal(settingsSectionFromSearch('?view=settings&sms_setup=1'), 'sms')
  assert.equal(settingsSectionFromSearch('?view=settings&integration_test=1'), 'testing')
  assert.equal(settingsSectionFromSearch('?view=settings&section=calendar&sms_setup=1'), 'calendar')
  assert.equal(settingsSectionFromSearch('?view=settings&section=unknown'), null)
})

test('moved payment history and reminders keep their parent module restrictions', () => {
  for (const role of ['owner', 'admin', 'office', 'technician', 'viewer'] as const) {
    for (const modules of [[], ['billing'], ['calendar'], ['billing', 'calendar']]) {
      const member = business(role, modules)
      assert.equal(canOpenView(member, 'payments'), canOpenView(member, 'invoices'))
      assert.equal(canOpenView(member, 'reminders'), canOpenView(member, 'schedule'))
    }
  }
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { GoogleCalendarService } from '../../server/calendar/google.js'
import { OutlookCalendarService } from '../../server/calendar/outlook.js'

process.env.GOOGLE_CALENDAR_CLIENT_ID = 'test'
process.env.GOOGLE_CALENDAR_CLIENT_SECRET = 'test'
process.env.OUTLOOK_CALENDAR_CLIENT_ID = 'test'
process.env.OUTLOOK_CALENDAR_CLIENT_SECRET = 'test'
process.env.CALENDAR_APP_ORIGIN = 'https://finviant.example'

function google(pages: (pageToken?: string) => unknown) {
  const service = new GoogleCalendarService({ access_token: 'test', refresh_token: 'test', expiry_date: Date.now() + 3600000 }, async () => {})
  ;(service as unknown as { api: unknown }).api = { calendarList: { list: async ({ pageToken }: { pageToken?: string }) => ({ data: pages(pageToken) }) } }
  return service
}
function outlook(pages: (path: string) => unknown) {
  const service = new OutlookCalendarService({}, async () => {})
  ;(service as unknown as { client: unknown }).client = { api: (path: string) => {
    const chain = { header: () => chain, option: () => chain, middlewareOptions: () => chain, get: async () => pages(path) }
    return chain
  } }
  return service
}

test('Google calendar choices continue through an empty page without losing the next token', async () => {
  const requested: Array<string | undefined> = []
  const service = google(token => {
    requested.push(token)
    return token ? { items: [{ id: 'work', summary: 'Work' }] } : { items: [], nextPageToken: 'opaque+/cursor==' }
  })
  assert.deepEqual(await service.calendars(), [{ id: 'work', name: 'Work' }])
  assert.deepEqual(requested, [undefined, 'opaque+/cursor=='])
})

test('Outlook calendar choices preserve opaque pagination and exclude read-only calendars', async () => {
  const requested: string[] = []
  const next = 'https://graph.microsoft.com/v1.0/me/calendars?$skiptoken=opaque%2Bcursor%3D%3D&$top=100'
  const service = outlook(path => {
    requested.push(path)
    return requested.length === 1 ? { value: [], '@odata.nextLink': next } : { value: [{ id: 'read', name: 'Read only', canEdit: false }, { id: 'work', name: 'Work', canEdit: true }] }
  })
  assert.deepEqual(await service.calendars(), [{ id: 'work', name: 'Work' }])
  assert.equal(requested[1], '/me/calendars?$skiptoken=opaque%2Bcursor%3D%3D&$top=100')
})

for (const vendor of ['Google', 'Outlook']) {
  test(`${vendor} repeated empty calendar pages fail before another provider request`, async () => {
    let calls = 0
    const page = () => {
      if (++calls > 3) throw new Error('test request safety ceiling')
      return vendor === 'Google' ? { items: [], nextPageToken: 'repeated' } : { value: [], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/calendars?$skiptoken=repeated' }
    }
    const service = vendor === 'Google' ? google(page) : outlook(page)
    await assert.rejects(() => service.calendars(), /invalid_provider_pagination/)
    assert.equal(calls, 2)
  })

  test(`${vendor} nonrepeating empty calendar pages are bounded rather than silently incomplete`, async () => {
    let calls = 0
    const page = () => {
      if (++calls > 21) throw new Error('test request safety ceiling')
      return vendor === 'Google' ? { items: [], nextPageToken: `cursor-${calls}` } : { value: [], '@odata.nextLink': `https://graph.microsoft.com/v1.0/me/calendars?$skiptoken=cursor-${calls}` }
    }
    const service = vendor === 'Google' ? google(page) : outlook(page)
    await assert.rejects(() => service.calendars(), /too_many_calendars/)
    assert.equal(calls, 20)
  })
}

test('Outlook rejects pagination that escapes the calendar collection before forwarding authentication', async () => {
  for (const next of [
    'https://attacker.example/v1.0/me/calendars?$skiptoken=x',
    'https://graph.microsoft.com/v1.0/me/calendars/another/events?$skiptoken=x',
    'https://graph.microsoft.com/v1.0/me/calendars-extra?$skiptoken=x',
    'https://user:password@graph.microsoft.com/v1.0/me/calendars?$skiptoken=x',
    'https://graph.microsoft.com/v1.0/me/calendars?$skiptoken=x#fragment',
  ]) {
    let calls = 0
    const service = outlook(() => { calls++; return calls === 1 ? { value: [], '@odata.nextLink': next } : { value: [] } })
    await assert.rejects(() => service.calendars(), /invalid_provider_pagination/)
    assert.equal(calls, 1)
  }
})

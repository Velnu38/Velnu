// Velnu deterministic high-volume input regression. No network, payments, emails,
// customer data, or database mutations. Uses *actual* application pure functions.
import { validateScheduleWindow } from '../../src/lib/scheduleTime.ts'
import { isQuickInvoiceCommand, parseQuickInvoice } from '../../src/lib/quickInvoice.ts'
import { formatServiceAddress, googleMapsDirectionsUrl, googleMapsSearchUrl, googleMapsEmbedUrl } from '../../src/lib/googleMaps.ts'
import { normalizeInterests } from '../../src/lib/serviceCatalog.ts'
import { formatMoney, formatStorage, assistantMonthlyTotal, assistantPriceForTier, monthlyPlans } from '../../src/lib/pricing.ts'

const assert = (condition: unknown, message: string): asserts condition => { if (!condition) throw new Error(message) }
const equal = (actual: unknown, expected: unknown, message: string) =>
  assert(actual === expected, message + ' expected=' + JSON.stringify(expected) + ' got=' + JSON.stringify(actual))
const pad = (value: number) => String(value).padStart(2, '0')
const local = (value: Date) =>
  value.getFullYear() + '-' + pad(value.getMonth() + 1) + '-' + pad(value.getDate()) +
  'T' + pad(value.getHours()) + ':' + pad(value.getMinutes())
const cases: Record<string, number> = {}
function batch(name: string, count: number, run: (i: number) => void) {
  for (let i = 0; i < count; i++) {
    try { run(i) } catch (error) {
      throw new Error(name + ' input #' + i + ': ' + (error instanceof Error ? error.message : String(error)))
    }
  }
  cases[name] = count
}

Deno.test('1800 generated inputs across schedules, invoice voice commands, maps, plan interests and pricing', () => {
  batch('schedule_valid', 150, i => {
    const start = new Date(2027, i % 12, 1 + (i % 25), 8 + (i % 10), i % 60)
    const end = new Date(start.getTime() + (1 + i % 120) * 60000)
    const result = validateScheduleWindow(local(start), local(end))
    equal(result.startsAt, start.toISOString(), 'start must reach the same UTC instant')
    equal(result.endsAt, end.toISOString(), 'end must reach the same UTC instant')
  })
  batch('schedule_invalid', 150, i => {
    const valid = '2027-11-08T12:00'
    const input = i % 6
    const [start, end] = input === 0 ? [valid, valid] :
      input === 1 ? [valid, '2027-11-08T11:59'] :
      input === 2 ? ['2027-02-30T10:00', ''] :
      input === 3 ? ['2027-13-02T10:00', ''] :
      input === 4 ? ['2027-11-08T25:00', ''] : [valid, 'unparseable']
    let rejected = false
    try { validateScheduleWindow(start, end) } catch { rejected = true }
    assert(rejected, 'invalid time must fail before a write')
  })
  batch('invoice_voice_valid', 100, i => {
    const amount = (i + 1) + '.25'
    const spoken = 'Create an invoice for Customer' + i + ' for service: Faucet repair $' + amount
    assert(isQuickInvoiceCommand(spoken), 'must identify invoice intent')
    const parsed = parseQuickInvoice(spoken)
    equal(parsed.customerName, 'Customer' + i, 'recipient extraction')
    equal(parsed.amount, amount, 'single payment amount must be preserved')
    equal(parsed.multipleAmounts, false, 'single price must not be flagged as multi-price')
  })
  batch('invoice_voice_multiple_prices', 100, i => {
    const spoken = 'Create invoice for Customer' + i + ' for work $' + (i + 20) + ' and materials $' + (i + 30)
    const parsed = parseQuickInvoice(spoken)
    equal(parsed.multipleAmounts, true, 'two prices must be flagged')
    equal(parsed.amount, '', 'two prices cannot silently merge into an invoice')
  })
  batch('invoice_voice_same_price_twice', 100, i => {
    const value = i + 10
    const parsed = parseQuickInvoice('Create invoice for Customer' + i + ' for labor 
    const spoken = 'Create invoice for Customer' + i + ' for work without a quoted price'
    const parsed = parseQuickInvoice(spoken)
    equal(parsed.amount, '', 'do not invent prices')
    equal(parsed.multipleAmounts, false, 'missing price is not a multiple-price case')
  })
  batch('customer_address_search', 150, i => {
    const address = {
      address_line1: (100 + i) + ' Main St',
      city: 'Chesapeake', state: 'VA', postal_code: '23320',
      phone: 'DO-NOT-SEND-PRIVATE-PHONE', access_notes: 'DO-NOT-SEND-ACCESS-CODE',
    }
    const formatted = formatServiceAddress(address)
    assert(formatted.includes((100 + i) + ' Main St'), 'street must be present')
    const url = new URL(googleMapsSearchUrl(address)!)
    equal(url.hostname, 'www.google.com', 'maps destination')
    equal(url.searchParams.get('query'), formatted, 'maps address matches formatted address')
    assert(!url.toString().includes('DO-NOT-SEND'), 'private data must not leak to provider URL')
  })
  batch('customer_address_directions', 150, i => {
    const address = { address_line1: 'Suite ' + i + ' 1st Avenue', address_line2: '#7', city: 'Suffolk', state: 'VA', postal_code: '23434' }
    const url = new URL(googleMapsDirectionsUrl(address)!)
    equal(url.searchParams.get('destination'), formatServiceAddress(address), 'directions match job location')
    equal(url.searchParams.get('travelmode'), 'driving', 'expected directions mode')
    const embed = googleMapsEmbedUrl(address, '')
    equal(embed, null, 'no embed without a configured key')
  })
  batch('service_interests_valid', 100, i => {
    const plan = i % 2 ? 'pro' : 'basic'
    const interests = normalizeInterests({ plan, services: ['voice_drafts', 'voice_drafts', 'bookkeeping', 'scheduling_assistant'] })
    equal(interests.plan, plan, 'retain selected valid plan')
    equal(interests.services.length, 3, 'deduplicate selected services')
    assert(interests.services.includes('scheduling_assistant'), 'authorized paid assistant interest retained')
  })
  batch('service_interests_invalid', 100, i => {
    const input = i % 2 ? { plan: 'malicious', services: ['unknown', 'voice_drafts', 88, 'voice_drafts'] }
      : { plan: 'free', services: ['scheduling_assistant', 'bookkeeping_assistant', 'voice_drafts', 'rogue'] }
    const normal = normalizeInterests(input)
    equal(normal.plan, 'free', 'unknown plan never grants a paid tier')
    equal(normal.services.length, 1, 'unknown or ineligible services filtered')
    equal(normal.services[0], 'voice_drafts', 'known preference preserved')
  })
  batch('service_interests_alacarte', 100, i => {
    const normal = normalizeInterests({ plan: 'a_la_carte', services: ['scheduling_assistant', 'bookkeeping_assistant', 'ai_100', 'voice_drafts', 'ai_100'] })
    equal(normal.plan, 'a_la_carte', 'retain non-billable service interest')
    equal(normal.services.join(','), 'ai_100,voice_drafts', 'exclude standalone assistant and duplicates')
  })
  batch('pricing_money', 100, i => {
    const amount = (i * 19 + 25) / 100
    equal(formatMoney(amount), '$' + amount.toFixed(2), 'currency formatting must not lose cents')
    assert(monthlyPlans.free.priceMonthlyUsd === 0, 'free tier remains zero cost')
  })
  batch('pricing_storage', 100, i => {
    const mb = 1024 * (i + 1)
    assert(formatStorage(mb).includes('GB'), 'large storage has GB units')
    equal(formatStorage(0), 'No hosted file storage', 'free storage remains unhosted')
  })
  batch('pricing_assistants', 100, i => {
    const tier = i % 2 ? 'basic' : 'pro'
    const price = assistantPriceForTier('scheduling_assistant', tier)
    assert(typeof price === 'number' && price > 0, 'defined paid assistant price')
    equal(assistantMonthlyTotal(tier, ['scheduling_assistant', 'scheduling_assistant']), price, 'duplicate selections are billed once in proposal math')
    equal(assistantMonthlyTotal('free', ['scheduling_assistant']), 0, 'free cannot have paid assistant charges')
  })
  const total = Object.values(cases).reduce((sum, count) => sum + count, 0)
  equal(total, 1800, 'minimum generated input count')
  console.log('VELNU_STRESS_INPUT_REPORT=' + JSON.stringify({ total, categories: cases, live_vendor_requests: 0, data_mutations: 0 }))
})
 + value + ' plus materials 
    const spoken = 'Create invoice for Customer' + i + ' for work without a quoted price'
    const parsed = parseQuickInvoice(spoken)
    equal(parsed.amount, '', 'do not invent prices')
    equal(parsed.multipleAmounts, false, 'missing price is not a multiple-price case')
  })
  batch('customer_address_search', 150, i => {
    const address = {
      address_line1: (100 + i) + ' Main St',
      city: 'Chesapeake', state: 'VA', postal_code: '23320',
      phone: 'DO-NOT-SEND-PRIVATE-PHONE', access_notes: 'DO-NOT-SEND-ACCESS-CODE',
    }
    const formatted = formatServiceAddress(address)
    assert(formatted.includes((100 + i) + ' Main St'), 'street must be present')
    const url = new URL(googleMapsSearchUrl(address)!)
    equal(url.hostname, 'www.google.com', 'maps destination')
    equal(url.searchParams.get('query'), formatted, 'maps address matches formatted address')
    assert(!url.toString().includes('DO-NOT-SEND'), 'private data must not leak to provider URL')
  })
  batch('customer_address_directions', 150, i => {
    const address = { address_line1: 'Suite ' + i + ' 1st Avenue', address_line2: '#7', city: 'Suffolk', state: 'VA', postal_code: '23434' }
    const url = new URL(googleMapsDirectionsUrl(address)!)
    equal(url.searchParams.get('destination'), formatServiceAddress(address), 'directions match job location')
    equal(url.searchParams.get('travelmode'), 'driving', 'expected directions mode')
    const embed = googleMapsEmbedUrl(address, '')
    equal(embed, null, 'no embed without a configured key')
  })
  batch('service_interests_valid', 100, i => {
    const plan = i % 2 ? 'pro' : 'basic'
    const interests = normalizeInterests({ plan, services: ['voice_drafts', 'voice_drafts', 'bookkeeping', 'scheduling_assistant'] })
    equal(interests.plan, plan, 'retain selected valid plan')
    equal(interests.services.length, 3, 'deduplicate selected services')
    assert(interests.services.includes('scheduling_assistant'), 'authorized paid assistant interest retained')
  })
  batch('service_interests_invalid', 100, i => {
    const input = i % 2 ? { plan: 'malicious', services: ['unknown', 'voice_drafts', 88, 'voice_drafts'] }
      : { plan: 'free', services: ['scheduling_assistant', 'bookkeeping_assistant', 'voice_drafts', 'rogue'] }
    const normal = normalizeInterests(input)
    equal(normal.plan, 'free', 'unknown plan never grants a paid tier')
    equal(normal.services.length, 1, 'unknown or ineligible services filtered')
    equal(normal.services[0], 'voice_drafts', 'known preference preserved')
  })
  batch('service_interests_alacarte', 100, i => {
    const normal = normalizeInterests({ plan: 'a_la_carte', services: ['scheduling_assistant', 'bookkeeping_assistant', 'ai_100', 'voice_drafts', 'ai_100'] })
    equal(normal.plan, 'a_la_carte', 'retain non-billable service interest')
    equal(normal.services.join(','), 'ai_100,voice_drafts', 'exclude standalone assistant and duplicates')
  })
  batch('pricing_money', 100, i => {
    const amount = (i * 19 + 25) / 100
    equal(formatMoney(amount), '$' + amount.toFixed(2), 'currency formatting must not lose cents')
    assert(monthlyPlans.free.priceMonthlyUsd === 0, 'free tier remains zero cost')
  })
  batch('pricing_storage', 100, i => {
    const mb = 1024 * (i + 1)
    assert(formatStorage(mb).includes('GB'), 'large storage has GB units')
    equal(formatStorage(0), 'No hosted file storage', 'free storage remains unhosted')
  })
  batch('pricing_assistants', 100, i => {
    const tier = i % 2 ? 'basic' : 'pro'
    const price = assistantPriceForTier('scheduling_assistant', tier)
    assert(typeof price === 'number' && price > 0, 'defined paid assistant price')
    equal(assistantMonthlyTotal(tier, ['scheduling_assistant', 'scheduling_assistant']), price, 'duplicate selections are billed once in proposal math')
    equal(assistantMonthlyTotal('free', ['scheduling_assistant']), 0, 'free cannot have paid assistant charges')
  })
  const total = Object.values(cases).reduce((sum, count) => sum + count, 0)
  equal(total, 1500, 'minimum generated input count')
  console.log('VELNU_STRESS_INPUT_REPORT=' + JSON.stringify({ total, categories: cases, live_vendor_requests: 0, data_mutations: 0 }))
})
 + value)
    equal(parsed.multipleAmounts, true, 'identical charges must still be treated as two amounts')
    equal(parsed.amount, '', 'repeated charges must not create a one-line invoice')
  })
  batch('invoice_voice_overlapping_dollar_notations', 100, i => {
    const value = i + 10
    const parsed = parseQuickInvoice('Create invoice for Customer' + i + ' for work 
    const spoken = 'Create invoice for Customer' + i + ' for work without a quoted price'
    const parsed = parseQuickInvoice(spoken)
    equal(parsed.amount, '', 'do not invent prices')
    equal(parsed.multipleAmounts, false, 'missing price is not a multiple-price case')
  })
  batch('customer_address_search', 150, i => {
    const address = {
      address_line1: (100 + i) + ' Main St',
      city: 'Chesapeake', state: 'VA', postal_code: '23320',
      phone: 'DO-NOT-SEND-PRIVATE-PHONE', access_notes: 'DO-NOT-SEND-ACCESS-CODE',
    }
    const formatted = formatServiceAddress(address)
    assert(formatted.includes((100 + i) + ' Main St'), 'street must be present')
    const url = new URL(googleMapsSearchUrl(address)!)
    equal(url.hostname, 'www.google.com', 'maps destination')
    equal(url.searchParams.get('query'), formatted, 'maps address matches formatted address')
    assert(!url.toString().includes('DO-NOT-SEND'), 'private data must not leak to provider URL')
  })
  batch('customer_address_directions', 150, i => {
    const address = { address_line1: 'Suite ' + i + ' 1st Avenue', address_line2: '#7', city: 'Suffolk', state: 'VA', postal_code: '23434' }
    const url = new URL(googleMapsDirectionsUrl(address)!)
    equal(url.searchParams.get('destination'), formatServiceAddress(address), 'directions match job location')
    equal(url.searchParams.get('travelmode'), 'driving', 'expected directions mode')
    const embed = googleMapsEmbedUrl(address, '')
    equal(embed, null, 'no embed without a configured key')
  })
  batch('service_interests_valid', 100, i => {
    const plan = i % 2 ? 'pro' : 'basic'
    const interests = normalizeInterests({ plan, services: ['voice_drafts', 'voice_drafts', 'bookkeeping', 'scheduling_assistant'] })
    equal(interests.plan, plan, 'retain selected valid plan')
    equal(interests.services.length, 3, 'deduplicate selected services')
    assert(interests.services.includes('scheduling_assistant'), 'authorized paid assistant interest retained')
  })
  batch('service_interests_invalid', 100, i => {
    const input = i % 2 ? { plan: 'malicious', services: ['unknown', 'voice_drafts', 88, 'voice_drafts'] }
      : { plan: 'free', services: ['scheduling_assistant', 'bookkeeping_assistant', 'voice_drafts', 'rogue'] }
    const normal = normalizeInterests(input)
    equal(normal.plan, 'free', 'unknown plan never grants a paid tier')
    equal(normal.services.length, 1, 'unknown or ineligible services filtered')
    equal(normal.services[0], 'voice_drafts', 'known preference preserved')
  })
  batch('service_interests_alacarte', 100, i => {
    const normal = normalizeInterests({ plan: 'a_la_carte', services: ['scheduling_assistant', 'bookkeeping_assistant', 'ai_100', 'voice_drafts', 'ai_100'] })
    equal(normal.plan, 'a_la_carte', 'retain non-billable service interest')
    equal(normal.services.join(','), 'ai_100,voice_drafts', 'exclude standalone assistant and duplicates')
  })
  batch('pricing_money', 100, i => {
    const amount = (i * 19 + 25) / 100
    equal(formatMoney(amount), '$' + amount.toFixed(2), 'currency formatting must not lose cents')
    assert(monthlyPlans.free.priceMonthlyUsd === 0, 'free tier remains zero cost')
  })
  batch('pricing_storage', 100, i => {
    const mb = 1024 * (i + 1)
    assert(formatStorage(mb).includes('GB'), 'large storage has GB units')
    equal(formatStorage(0), 'No hosted file storage', 'free storage remains unhosted')
  })
  batch('pricing_assistants', 100, i => {
    const tier = i % 2 ? 'basic' : 'pro'
    const price = assistantPriceForTier('scheduling_assistant', tier)
    assert(typeof price === 'number' && price > 0, 'defined paid assistant price')
    equal(assistantMonthlyTotal(tier, ['scheduling_assistant', 'scheduling_assistant']), price, 'duplicate selections are billed once in proposal math')
    equal(assistantMonthlyTotal('free', ['scheduling_assistant']), 0, 'free cannot have paid assistant charges')
  })
  const total = Object.values(cases).reduce((sum, count) => sum + count, 0)
  equal(total, 1500, 'minimum generated input count')
  console.log('VELNU_STRESS_INPUT_REPORT=' + JSON.stringify({ total, categories: cases, live_vendor_requests: 0, data_mutations: 0 }))
})
 + value + ' dollars')
    equal(parsed.multipleAmounts, false, 'one currency mention must not be double counted')
    equal(parsed.amount, String(value), 'one currency mention retains the exact amount')
  })
  batch('invoice_voice_negative_amounts', 100, i => {
    const parsed = parseQuickInvoice('Create invoice for Customer' + i + ' for a refund -
    const spoken = 'Create invoice for Customer' + i + ' for work without a quoted price'
    const parsed = parseQuickInvoice(spoken)
    equal(parsed.amount, '', 'do not invent prices')
    equal(parsed.multipleAmounts, false, 'missing price is not a multiple-price case')
  })
  batch('customer_address_search', 150, i => {
    const address = {
      address_line1: (100 + i) + ' Main St',
      city: 'Chesapeake', state: 'VA', postal_code: '23320',
      phone: 'DO-NOT-SEND-PRIVATE-PHONE', access_notes: 'DO-NOT-SEND-ACCESS-CODE',
    }
    const formatted = formatServiceAddress(address)
    assert(formatted.includes((100 + i) + ' Main St'), 'street must be present')
    const url = new URL(googleMapsSearchUrl(address)!)
    equal(url.hostname, 'www.google.com', 'maps destination')
    equal(url.searchParams.get('query'), formatted, 'maps address matches formatted address')
    assert(!url.toString().includes('DO-NOT-SEND'), 'private data must not leak to provider URL')
  })
  batch('customer_address_directions', 150, i => {
    const address = { address_line1: 'Suite ' + i + ' 1st Avenue', address_line2: '#7', city: 'Suffolk', state: 'VA', postal_code: '23434' }
    const url = new URL(googleMapsDirectionsUrl(address)!)
    equal(url.searchParams.get('destination'), formatServiceAddress(address), 'directions match job location')
    equal(url.searchParams.get('travelmode'), 'driving', 'expected directions mode')
    const embed = googleMapsEmbedUrl(address, '')
    equal(embed, null, 'no embed without a configured key')
  })
  batch('service_interests_valid', 100, i => {
    const plan = i % 2 ? 'pro' : 'basic'
    const interests = normalizeInterests({ plan, services: ['voice_drafts', 'voice_drafts', 'bookkeeping', 'scheduling_assistant'] })
    equal(interests.plan, plan, 'retain selected valid plan')
    equal(interests.services.length, 3, 'deduplicate selected services')
    assert(interests.services.includes('scheduling_assistant'), 'authorized paid assistant interest retained')
  })
  batch('service_interests_invalid', 100, i => {
    const input = i % 2 ? { plan: 'malicious', services: ['unknown', 'voice_drafts', 88, 'voice_drafts'] }
      : { plan: 'free', services: ['scheduling_assistant', 'bookkeeping_assistant', 'voice_drafts', 'rogue'] }
    const normal = normalizeInterests(input)
    equal(normal.plan, 'free', 'unknown plan never grants a paid tier')
    equal(normal.services.length, 1, 'unknown or ineligible services filtered')
    equal(normal.services[0], 'voice_drafts', 'known preference preserved')
  })
  batch('service_interests_alacarte', 100, i => {
    const normal = normalizeInterests({ plan: 'a_la_carte', services: ['scheduling_assistant', 'bookkeeping_assistant', 'ai_100', 'voice_drafts', 'ai_100'] })
    equal(normal.plan, 'a_la_carte', 'retain non-billable service interest')
    equal(normal.services.join(','), 'ai_100,voice_drafts', 'exclude standalone assistant and duplicates')
  })
  batch('pricing_money', 100, i => {
    const amount = (i * 19 + 25) / 100
    equal(formatMoney(amount), '$' + amount.toFixed(2), 'currency formatting must not lose cents')
    assert(monthlyPlans.free.priceMonthlyUsd === 0, 'free tier remains zero cost')
  })
  batch('pricing_storage', 100, i => {
    const mb = 1024 * (i + 1)
    assert(formatStorage(mb).includes('GB'), 'large storage has GB units')
    equal(formatStorage(0), 'No hosted file storage', 'free storage remains unhosted')
  })
  batch('pricing_assistants', 100, i => {
    const tier = i % 2 ? 'basic' : 'pro'
    const price = assistantPriceForTier('scheduling_assistant', tier)
    assert(typeof price === 'number' && price > 0, 'defined paid assistant price')
    equal(assistantMonthlyTotal(tier, ['scheduling_assistant', 'scheduling_assistant']), price, 'duplicate selections are billed once in proposal math')
    equal(assistantMonthlyTotal('free', ['scheduling_assistant']), 0, 'free cannot have paid assistant charges')
  })
  const total = Object.values(cases).reduce((sum, count) => sum + count, 0)
  equal(total, 1500, 'minimum generated input count')
  console.log('VELNU_STRESS_INPUT_REPORT=' + JSON.stringify({ total, categories: cases, live_vendor_requests: 0, data_mutations: 0 }))
})
 + (i + 10))
    equal(parsed.amount, '', 'negative refund must not become a positive invoice')
  })
  batch('invoice_voice_no_price', 100, i => {
    const spoken = 'Create invoice for Customer' + i + ' for work without a quoted price'
    const parsed = parseQuickInvoice(spoken)
    equal(parsed.amount, '', 'do not invent prices')
    equal(parsed.multipleAmounts, false, 'missing price is not a multiple-price case')
  })
  batch('customer_address_search', 150, i => {
    const address = {
      address_line1: (100 + i) + ' Main St',
      city: 'Chesapeake', state: 'VA', postal_code: '23320',
      phone: 'DO-NOT-SEND-PRIVATE-PHONE', access_notes: 'DO-NOT-SEND-ACCESS-CODE',
    }
    const formatted = formatServiceAddress(address)
    assert(formatted.includes((100 + i) + ' Main St'), 'street must be present')
    const url = new URL(googleMapsSearchUrl(address)!)
    equal(url.hostname, 'www.google.com', 'maps destination')
    equal(url.searchParams.get('query'), formatted, 'maps address matches formatted address')
    assert(!url.toString().includes('DO-NOT-SEND'), 'private data must not leak to provider URL')
  })
  batch('customer_address_directions', 150, i => {
    const address = { address_line1: 'Suite ' + i + ' 1st Avenue', address_line2: '#7', city: 'Suffolk', state: 'VA', postal_code: '23434' }
    const url = new URL(googleMapsDirectionsUrl(address)!)
    equal(url.searchParams.get('destination'), formatServiceAddress(address), 'directions match job location')
    equal(url.searchParams.get('travelmode'), 'driving', 'expected directions mode')
    const embed = googleMapsEmbedUrl(address, '')
    equal(embed, null, 'no embed without a configured key')
  })
  batch('service_interests_valid', 100, i => {
    const plan = i % 2 ? 'pro' : 'basic'
    const interests = normalizeInterests({ plan, services: ['voice_drafts', 'voice_drafts', 'bookkeeping', 'scheduling_assistant'] })
    equal(interests.plan, plan, 'retain selected valid plan')
    equal(interests.services.length, 3, 'deduplicate selected services')
    assert(interests.services.includes('scheduling_assistant'), 'authorized paid assistant interest retained')
  })
  batch('service_interests_invalid', 100, i => {
    const input = i % 2 ? { plan: 'malicious', services: ['unknown', 'voice_drafts', 88, 'voice_drafts'] }
      : { plan: 'free', services: ['scheduling_assistant', 'bookkeeping_assistant', 'voice_drafts', 'rogue'] }
    const normal = normalizeInterests(input)
    equal(normal.plan, 'free', 'unknown plan never grants a paid tier')
    equal(normal.services.length, 1, 'unknown or ineligible services filtered')
    equal(normal.services[0], 'voice_drafts', 'known preference preserved')
  })
  batch('service_interests_alacarte', 100, i => {
    const normal = normalizeInterests({ plan: 'a_la_carte', services: ['scheduling_assistant', 'bookkeeping_assistant', 'ai_100', 'voice_drafts', 'ai_100'] })
    equal(normal.plan, 'a_la_carte', 'retain non-billable service interest')
    equal(normal.services.join(','), 'ai_100,voice_drafts', 'exclude standalone assistant and duplicates')
  })
  batch('pricing_money', 100, i => {
    const amount = (i * 19 + 25) / 100
    equal(formatMoney(amount), '$' + amount.toFixed(2), 'currency formatting must not lose cents')
    assert(monthlyPlans.free.priceMonthlyUsd === 0, 'free tier remains zero cost')
  })
  batch('pricing_storage', 100, i => {
    const mb = 1024 * (i + 1)
    assert(formatStorage(mb).includes('GB'), 'large storage has GB units')
    equal(formatStorage(0), 'No hosted file storage', 'free storage remains unhosted')
  })
  batch('pricing_assistants', 100, i => {
    const tier = i % 2 ? 'basic' : 'pro'
    const price = assistantPriceForTier('scheduling_assistant', tier)
    assert(typeof price === 'number' && price > 0, 'defined paid assistant price')
    equal(assistantMonthlyTotal(tier, ['scheduling_assistant', 'scheduling_assistant']), price, 'duplicate selections are billed once in proposal math')
    equal(assistantMonthlyTotal('free', ['scheduling_assistant']), 0, 'free cannot have paid assistant charges')
  })
  const total = Object.values(cases).reduce((sum, count) => sum + count, 0)
  equal(total, 1500, 'minimum generated input count')
  console.log('VELNU_STRESS_INPUT_REPORT=' + JSON.stringify({ total, categories: cases, live_vendor_requests: 0, data_mutations: 0 }))
})

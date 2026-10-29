/** Google Maps universal URLs work on iPhone, Android, and web without a key.
 * Only address fields enter Google Maps; access notes, names and phone numbers do not.
 */
export type ServiceAddress = {
  address_line1: string
  address_line2?: string | null
  city?: string | null
  state?: string | null
  postal_code?: string | null
}

export function formatServiceAddress(address: ServiceAddress): string {
  const street = [address.address_line1, address.address_line2]
    .map(part => String(part || '').trim()).filter(Boolean).join(', ')
  const locality = [address.city, address.state].map(part => String(part || '').trim()).filter(Boolean).join(', ')
  const localityWithZip = [locality, String(address.postal_code || '').trim()].filter(Boolean).join(' ')
  return [street, localityWithZip].filter(Boolean).join(', ').slice(0, 600)
}

export function googleMapsSearchUrl(address: ServiceAddress): string | null {
  const location = formatServiceAddress(address)
  if (!address.address_line1?.trim() || !location) return null
  const url = new URL('https://www.google.com/maps/search/')
  url.searchParams.set('api', '1')
  url.searchParams.set('query', location)
  return url.toString()
}

export function googleMapsDirectionsUrl(address: ServiceAddress): string | null {
  const location = formatServiceAddress(address)
  if (!address.address_line1?.trim() || !location) return null
  const url = new URL('https://www.google.com/maps/dir/')
  url.searchParams.set('api', '1')
  url.searchParams.set('destination', location)
  url.searchParams.set('travelmode', 'driving')
  return url.toString()
}

export function googleMapsEmbedUrl(address: ServiceAddress, apiKey: string | undefined): string | null {
  const location = formatServiceAddress(address)
  if (!apiKey?.trim() || !address.address_line1?.trim() || !location) return null
  const url = new URL('https://www.google.com/maps/embed/v1/place')
  url.searchParams.set('key', apiKey.trim())
  url.searchParams.set('q', location)
  return url.toString()
}

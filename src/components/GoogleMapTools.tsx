import { useState } from 'react'
import { formatServiceAddress, googleMapsDirectionsUrl, googleMapsEmbedUrl, googleMapsSearchUrl, type ServiceAddress } from '../lib/googleMaps'

/** Navigation always works without a key. The iframe is optional and loads only on click. */
export default function GoogleMapTools({ address, preview = false, compact = false }: {
  address: ServiceAddress
  preview?: boolean
  compact?: boolean
}) {
  const [showMap, setShowMap] = useState(false)
  const formatted = formatServiceAddress(address)
  const mapUrl = googleMapsSearchUrl(address)
  const directions = googleMapsDirectionsUrl(address)
  const embedUrl = googleMapsEmbedUrl(address, import.meta.env.VITE_GOOGLE_MAPS_EMBED_KEY)
  if (!mapUrl || !directions) return <p className="quiet">Add a street address to enable Google Maps.</p>

  return <div className={'google-maps-tools' + (compact ? ' compact' : '')}>
    <div className="google-maps-actions">
      <a className="google-maps-link" href={mapUrl} target="_blank" rel="noopener noreferrer" aria-label={'View ' + formatted + ' in Google Maps'}>View on Google Maps <span aria-hidden="true">↗</span></a>
      <a className="google-maps-link directions" href={directions} target="_blank" rel="noopener noreferrer" aria-label={'Get driving directions to ' + formatted}>Get directions <span aria-hidden="true">↗</span></a>
      {preview && embedUrl && <button type="button" className="google-maps-preview-toggle" onClick={() => setShowMap(v => !v)} aria-expanded={showMap}>{showMap ? 'Hide map' : 'Show map here'}</button>}
    </div>
    {preview && showMap && embedUrl && <div className="google-maps-embed-wrap">
      <iframe title={'Map of ' + formatted} src={embedUrl} loading="lazy" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
      <p>Location shown by Google Maps. Confirm the pin before traveling.</p>
    </div>}
  </div>
}

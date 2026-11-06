import { useEffect, useState } from 'react'
import { getStorageUsage, storageSize, type StorageUsage as Usage } from '../lib/businessStorage'

export default function StorageUsage({ businessId, version = 0, detailed = false }: { businessId: string; version?: number; detailed?: boolean }) {
  const [usage, setUsage] = useState<Usage | null>(null)
  const [error, setError] = useState(false)
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    let active = true
    setUsage(null); setError(false)
    void getStorageUsage(businessId).then(value => { if (active) setUsage(value) }).catch(() => { if (active) setError(true) })
    return () => { active = false }
  }, [businessId, version, refresh])
  return <section aria-label="Business storage" className="storage-usage">
    {detailed && <h2>Business storage</h2>}
    {error ? <p role="status">Storage usage is unavailable. Uploads still check your allowance.</p> : !usage ? <p role="status">Checking storage…</p> : <>
      <p><strong>{storageSize(usage.used_bytes)} of {storageSize(usage.limit_bytes)}</strong> used across this business.</p>
      <progress aria-label="Storage used" value={Math.min(usage.used_bytes, usage.limit_bytes)} max={usage.limit_bytes} />
      {usage.warning !== 'none' && <p role="status">{usage.warning === 'full' ? 'Storage is full. Remove optional pictures to make room for new uploads.' : `At least ${usage.warning === 'critical' ? '95%' : '80%'} of your storage allowance is used. Review optional pictures before uploading more.`} Existing records and payment actions remain available.</p>}
      {usage.pending_bytes > 0 && <p className="quiet">Includes {storageSize(usage.pending_bytes)} reserved for unconfirmed uploads. Refresh after uploading; contact Help &amp; Support if this remains pending.</p>}
    </>}
    {detailed && <><p>Photos and hosted logos share one allowance: Free 100 MB, Individual 2 GB, Business 10 GB. It does not reset monthly or multiply with team members. Your active entitlement determines the allowance.</p><p>Pictures: up to 10 MB each. Logos: up to 2 MB on an eligible plan. Core invoice, estimate, customer and payment records do not count toward this attachment allowance. Reaching the limit does not automatically delete files or create overage charges.</p><p>Remove optional pictures from the associated job, estimate or invoice. Earlier logos may remain in use by issued documents and continue to count toward storage.</p><button type="button" className="secondary-button" onClick={() => setRefresh(value => value + 1)}>Refresh storage</button></>}
  </section>
}

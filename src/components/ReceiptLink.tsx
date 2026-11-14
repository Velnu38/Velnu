import { useState } from 'react'
import { getReceiptUrl } from '../services/receiptCapture'

export default function ReceiptLink({ path }: { path: string }) {
  const [url, setUrl] = useState(''), [error, setError] = useState(''), [loading, setLoading] = useState(false)
  return <details className="receipt-link" onToggle={event => {
    if (!event.currentTarget.open) return
    setUrl(''); setError(''); setLoading(true)
    void getReceiptUrl(path).then(setUrl).catch(e => setError(e.message)).finally(() => setLoading(false))
  }}>
    <summary>View receipt</summary>
    {loading && <span role="status">Opening receipt…</span>}
    {url && <a href={url} target="_blank" rel="noopener noreferrer">Open receipt image</a>}
    {error && <span role="status">{error}</span>}
  </details>
}

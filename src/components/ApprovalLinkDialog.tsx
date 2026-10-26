import { useState } from 'react'

export default function ApprovalLinkDialog({ url, title, expiresAt, onClose }: { url: string; title: string; expiresAt: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return <div className="modal-backdrop" onMouseDown={onClose}><section className="modal approval-link-dialog" onMouseDown={(e) => e.stopPropagation()}>
    <div className="modal-head"><div><p className="eyebrow">Customer approval</p><h2>{title}</h2></div><button className="icon-button" onClick={onClose}>×</button></div>
    <p>Send this private link to the customer. They can review the exact amount and scope, then approve or decline without creating a Velnu account. Estimate acceptance requires their name and explicit agreement to the estimate terms.</p>
    <label>Approval link<input readOnly value={url} onFocus={(e) => e.currentTarget.select()} /></label>
    <p className="quiet">Expires {new Date(expiresAt).toLocaleString()}. Creating another approval link for this document revokes the previous link.</p>
    <div className="modal-actions"><button className="secondary-button" onClick={onClose}>Close</button><button className="primary-button" onClick={copy}>{copied ? 'Copied' : 'Copy link'}</button></div>
  </section></div>
}

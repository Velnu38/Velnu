import { useRef,useState } from 'react'
import FormDialog from './FormDialog'

export default function ApprovalLinkDialog({ url, title, expiresAt, onClose }: { url: string; title: string; expiresAt: string; onClose: () => void }) {
  const field=useRef<HTMLInputElement>(null),[copyError,setCopyError]=useState('')
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true);setCopyError('')
    } catch {
      setCopied(false);field.current?.focus();field.current?.select();setCopyError('Automatic copying is unavailable. The link is selected; use your device’s Copy command.')
    }
  }

  return <FormDialog label={title} onClose={onClose}><div className="approval-link-dialog">
    <div className="modal-head"><div><p className="eyebrow">Customer approval</p><h2>{title}</h2></div><button className="icon-button" onClick={onClose} aria-label="Close" type="button">×</button></div>
    <p>Send this private link to the customer. They can review the exact amount and scope, then approve or decline without creating a Finviant Office account. Estimate acceptance requires their name and explicit agreement to the estimate terms.</p>
    <label>Approval link<input ref={field} readOnly value={url} onFocus={(e) => e.currentTarget.select()} /></label>
    <p className="quiet">Expires {new Date(expiresAt).toLocaleString()}. Creating another approval link for this document revokes the previous link.</p>
    {copyError&&<p role="status">{copyError}</p>}
    <div className="modal-actions"><button className="secondary-button" onClick={onClose}>Close</button><button className="primary-button" onClick={copy}>{copied ? 'Copied' : 'Copy link'}</button></div>
  </div></FormDialog>
}

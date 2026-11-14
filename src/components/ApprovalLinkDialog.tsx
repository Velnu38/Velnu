import { useRef,useState } from 'react'
import FormDialog from './FormDialog'

export default function ApprovalLinkDialog({ url, title, expiresAt, onClose, onReplace }: { url: string; title: string; expiresAt: string|null; onClose: () => void; onReplace?:()=>Promise<void> }) {
  const field=useRef<HTMLInputElement>(null),[copyError,setCopyError]=useState('')
  const [copied, setCopied] = useState(false)
  const [replacing,setReplacing]=useState(false)
  async function replace(){
    if(!onReplace||replacing||!window.confirm('Replace this approval link? Earlier approval links for this document will stop accepting decisions. The issued document stays in its history.'))return
    setReplacing(true);setCopyError('')
    try{await onReplace();setCopied(false)}catch(error){setCopyError(error instanceof Error?error.message:'The link could not be replaced. Try again.')}
    finally{setReplacing(false)}
  }

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
    <p className="quiet">{expiresAt?'Approval deadline: '+new Date(expiresAt).toLocaleString()+'. ':''}Resending this link keeps it valid. Approval deadlines apply to recording a decision; the issued document remains available for records.</p>
    {copyError&&<p role="status">{copyError}</p>}
    <div className="modal-actions">{onReplace&&<button className="text-button" disabled={replacing} onClick={()=>void replace()}>{replacing?'Replacing…':'Replace approval link'}</button>}<button className="secondary-button" disabled={replacing} onClick={onClose}>Close</button><button className="primary-button" disabled={replacing} onClick={copy}>{copied ? 'Copied' : 'Copy link'}</button></div>
  </div></FormDialog>
}

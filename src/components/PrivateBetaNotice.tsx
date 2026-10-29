import './private-beta.css'
export default function PrivateBetaNotice({ compact = false }: { compact?: boolean }) {
  return <aside className={'private-beta-notice' + (compact ? ' private-beta-notice-compact' : '')} role="status" aria-label="Private testing notice">
    <strong>Private testing — no subscription or charges</strong>
    <p>Finviant Office is being tested. Test data, including account and business records, may be changed, reset, or deleted without notice. Use fictional or nonessential information and keep your own copies of anything important.</p>
  </aside>
}

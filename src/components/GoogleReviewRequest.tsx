import { useState } from 'react'
import type { CurrentBusiness } from '../lib/business'
import { normalizeGoogleReviewUrl } from '../lib/googleReviews'
import { personalEmailHref, personalSmsHref } from '../lib/personalDelivery'
import type { VelnuTier } from '../lib/pricing'
import { settingsHref } from '../lib/settingsNavigation'
import { isPrimaryOwner } from '../lib/workspaceAccess'
import PlanRestriction from './PlanRestriction'

export default function GoogleReviewRequest({ business, plan, customer }: {
  business: CurrentBusiness
  plan: VelnuTier
  customer?: { first_name?: string | null; email?: string | null; phone?: string | null }
}) {
  const [open, setOpen] = useState(false), [notice, setNotice] = useState('')
  const owner = isPrimaryOwner(business)
  if (plan === 'free') return <PlanRestriction plan={plan} required="basic" feature="Requesting Google reviews" canUpgrade={owner} />
  let link: string | null = null
  try { link = normalizeGoogleReviewUrl(business.google_review_url || '') } catch { /* Offer profile setup if the stored link is invalid. */ }
  if (!link) return <p className="quiet" data-editor-independent>{owner
    ? <a href={settingsHref('company')}>Set up your Google review link</a>
    : 'Ask your workspace owner to add a Google review link in Company Profile.'}</p>

  const name = customer?.first_name?.trim()
  const message = `Hi${name ? ' '+name : ''}, thanks for choosing ${business.name}. If you’d like to share your experience, you can leave us a Google review here:\n${link}`
  let email = '', sms = ''
  try { if (customer?.email) email = personalEmailHref(customer.email, 'Share your experience with ' + business.name, message) } catch { /* Copy is available. */ }
  try { if (customer?.phone) sms = personalSmsHref(customer.phone, message) } catch { /* Copy is available. */ }
  return <section data-editor-independent aria-label="Google review request">
    <button type="button" className="secondary-button" data-keep-dialog aria-expanded={open} onClick={() => setOpen(value => !value)}>Request a Google review</button>
    {open && <div className="settings-inset">
      <p className="quiet">Review the message before sending it from your own app.</p>
      <label>Review request message<textarea readOnly rows={3} value={message} /></label>
      <div className="job-details-controls">
        {email && <a className="secondary-button compact" href={email}>Open email</a>}
        {sms && <a className="secondary-button compact" href={sms}>Open text</a>}
        <button type="button" className="secondary-button compact" onClick={() => {
          void navigator.clipboard.writeText(message).then(()=>setNotice('Request copied.')).catch(()=>setNotice('Select and copy the message above.'))
        }}>Copy message</button>
      </div>
      {notice && <p role="status">{notice}</p>}
    </div>}
  </section>
}

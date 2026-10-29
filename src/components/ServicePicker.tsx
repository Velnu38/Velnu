import { serviceCatalog, optionalTopUps, plans, type ServiceId, type ServiceInterest, type PlanInterest } from '../lib/serviceCatalog'
import { assistantAddOns, assistantMonthlyTotal, formatMoney, monthlyPlans } from '../lib/pricing'

export default function ServicePicker({ value, onChange, disabled = false, compact = false }: {
  value: ServiceInterest
  onChange: (next: ServiceInterest) => void
  disabled?: boolean
  compact?: boolean
}) {
  function selectPlan(plan: PlanInterest) {
    const next = plan === 'free' ? [] : plan === 'basic' || plan === 'pro'
      ? value.services : value.services.filter(id => !assistantAddOns.some(a => a.id === id))
    onChange({ plan, services: next })
  }
  function toggleService(id: ServiceId, enabled: boolean) {
    onChange({ ...value, plan: enabled && value.plan === 'free' ? 'a_la_carte' : value.plan,
      services: enabled ? [...new Set([...value.services, id])] : value.services.filter(x => x !== id) })
  }
  const paidTier = value.plan === 'basic' || value.plan === 'pro' ? value.plan : null
  const assistantsTotal = paidTier ? assistantMonthlyTotal(paidTier, value.services) : 0
  const estimatedTotal = paidTier ? monthlyPlans[paidTier].priceMonthlyUsd + assistantsTotal : 0
  return <div className={'service-picker' + (compact ? ' service-picker-compact' : '')}>
    <fieldset className="service-plan-choices">
      <legend>Which plan are you interested in?</legend>
      <div className="service-plan-grid">
        {plans.map(plan => <label key={plan.id} className={'service-plan-option' + (value.plan === plan.id ? ' selected' : '')}>
          <input type="radio" name="service-plan" value={plan.id} checked={value.plan === plan.id} disabled={disabled}
            onChange={() => selectPlan(plan.id)} />
          <strong>{plan.label}</strong><span>{plan.description}</span>
        </label>)}
      </div>
    </fieldset>
    <fieldset className="service-addon-choices">
      <legend>Explore individual services</legend>
      <p>Free includes manual tools only, with 0 online customer approvals, AI requests, automatic email, SMS or paid integrations. Any checked item is an interest in a future paid add-on—not a service activation.</p>
      <div className="service-addon-grid">
        {serviceCatalog.map(service => <label className={'service-addon-card' + (value.services.includes(service.id) ? ' selected' : '')} key={service.id}>
          <input type="checkbox" checked={value.services.includes(service.id)} disabled={disabled}
            onChange={event => toggleService(service.id, event.target.checked)} />
          <span className="service-addon-card-content">
            <span className="service-addon-top"><strong>{service.name}</strong><span className="service-addon-status">{service.stage}</span></span>
            <small>{service.description}</small>
          </span>
        </label>)}
      </div>
    </fieldset>
    <fieldset className="service-addon-choices service-assistant-options">
      <legend>Optional AI Assistants — Basic and Pro</legend>
      <p>Your existing calendar and manual bookkeeping workbook do not require these upgrades. These add-ons would provide more AI-assisted suggestions and analysis, not full-service accounting or automatic dispatch. A user must approve suggested changes. Pricing is proposed; no purchase or activation occurs now.</p>
      <div className="service-addon-grid">
        {assistantAddOns.map(assistant => <label key={assistant.id} className={'service-addon-card' + (value.services.includes(assistant.id) ? ' selected' : '') + (!paidTier ? ' service-addon-unavailable' : '')}>
          <input type="checkbox" checked={value.services.includes(assistant.id)} disabled={disabled || !paidTier}
            onChange={event => toggleService(assistant.id, event.target.checked)} />
          <span className="service-addon-card-content">
            <span className="service-addon-top">
              <strong>{assistant.name}</strong>
              <span className="service-addon-status">{paidTier ? formatMoney(assistant.priceMonthlyByTier[paidTier]) + ' / mo' : 'Select Basic or Pro'}</span>
            </span>
            <small>{assistant.summary}</small>
            <small>{assistant.status}</small>
          </span>
        </label>)}
      </div>
      {paidTier && <p className="service-assistant-subtotal">Proposed monthly estimate: {formatMoney(monthlyPlans[paidTier].priceMonthlyUsd)} base + {formatMoney(assistantsTotal)} assistants = <strong>{formatMoney(estimatedTotal)} / month</strong>. One-time credit packs or extra storage are separate.</p>}
    </fieldset>
    <fieldset className="service-addon-choices">
      <legend>Extra AI credits and file storage</legend>
      <p>Choose any add-ons you may want after your included allowance runs out. Prices are proposals; selecting an option only records interest. No credits, storage or paid access are activated during the beta.</p>
      <div className="service-addon-grid">
        {optionalTopUps.map(addon => <label className={'service-addon-card' + (value.services.includes(addon.id) ? ' selected' : '')} key={addon.id}>
          <input type="checkbox" checked={value.services.includes(addon.id)} disabled={disabled}
            onChange={event => toggleService(addon.id, event.target.checked)} />
          <span className="service-addon-card-content">
            <span className="service-addon-top"><strong>{addon.quantityLabel}</strong><span className="service-addon-status">{addon.priceLabel} / {addon.billing === 'one-time' ? 'pack' : 'month'}</span></span>
            <small>{addon.description} Billing and fulfillment are not live.</small>
          </span>
        </label>)}
      </div>
    </fieldset>
    <div className="service-picker-summary" role="status" aria-live="polite">
      <strong>{value.services.length} optional {value.services.length === 1 ? 'service' : 'services'} selected</strong>
      <span>{plans.find(x => x.id === value.plan)?.label ?? 'Free'} interest · No charges during private beta · Add-on prices proposed</span>
    </div>
  </div>
}

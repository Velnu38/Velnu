import { serviceCatalog, plans, type ServiceId, type ServiceInterest, type PlanInterest } from '../lib/serviceCatalog'

export default function ServicePicker({ value, onChange, disabled = false, compact = false }: {
  value: ServiceInterest
  onChange: (next: ServiceInterest) => void
  disabled?: boolean
  compact?: boolean
}) {
  function selectPlan(plan: PlanInterest) { onChange(plan === 'free' ? { plan, services: [] } : { ...value, plan }) }
  function toggleService(id: ServiceId, enabled: boolean) {
    onChange({ ...value, plan: enabled && value.plan === 'free' ? 'a_la_carte' : value.plan,
      services: enabled ? [...new Set([...value.services, id])] : value.services.filter(x => x !== id) })
  }
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
    <div className="service-picker-summary" role="status" aria-live="polite">
      <strong>{value.services.length} optional {value.services.length === 1 ? 'service' : 'services'} selected</strong>
      <span>{plans.find(x => x.id === value.plan)?.label ?? 'Free'} interest · No charges · Prices to be announced</span>
    </div>
  </div>
}

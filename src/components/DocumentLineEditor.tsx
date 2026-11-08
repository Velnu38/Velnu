import ServiceItemPicker from './ServiceItemPicker'
import { useRef, useState } from 'react'

export type DraftLine = { description: string; quantity: string; unit_price: string; tax_rate: string }
const fields = ['description', 'unit_price', 'quantity', 'tax_rate'] as const
const captions = { description: 'Description', unit_price: 'Unit price', quantity: 'Qty', tax_rate: 'Tax %' }
const labels = { description: 'description', unit_price: 'unit price', quantity: 'quantity', tax_rate: 'Tax rate (%)' }

export default function DocumentLineEditor({ lines, onChange, newLine, taxOptions = false, taxDefault, businessId }: {
  businessId?: string
  lines: DraftLine[]
  onChange: (lines: DraftLine[]) => void
  newLine: () => DraftLine
  taxOptions?: boolean
  taxDefault?: { rate: string; onChange: (rate: string) => void }
}) {
  const [removed, setRemoved] = useState<{ line: DraftLine; index: number } | null>(null)
  const [localDefaultTax, setLocalDefaultTax] = useState(() => lines[0]?.tax_rate || newLine().tax_rate)
  const defaultTax = taxDefault?.rate ?? localDefaultTax
  const undo = useRef<HTMLButtonElement>(null)
  const makeLine = () => taxOptions ? { ...newLine(), tax_rate: defaultTax || '0' } : newLine()
  const taxUsed = Number(defaultTax) > 0
  const mixedTax = lines.some(line => Number(line.tax_rate) !== Number(defaultTax))

  function updateLine(index: number, key: keyof DraftLine, value: string) {
    onChange(lines.map((line, i) => i === index ? { ...line, [key]: value } : line))
  }

  function renderInput(line: DraftLine, index: number, key: keyof DraftLine) {
    return <input aria-label={`Line ${index + 1} ${labels[key]}`} placeholder={captions[key]}
      type={key === 'description' ? 'text' : 'number'} maxLength={key === 'description' ? 2000 : undefined}
      min={key === 'quantity' ? '0.01' : key === 'description' ? undefined : '0'}
      max={key === 'tax_rate' ? '100' : undefined} step={key === 'description' ? undefined : '0.01'}
      value={line[key]} required={key !== 'tax_rate' || !taxOptions}
      onChange={event => updateLine(index, key, event.target.value)} />
  }

  return <div className="line-items">
    <div className="line-items-head"><strong>Line items</strong><button type="button" className="text-button" disabled={lines.length >= 50} onClick={() => onChange([...lines, makeLine()])}>+ Add line</button></div>
    {businessId&&<ServiceItemPicker businessId={businessId} lines={lines} onChange={onChange}/>}
    {lines.map((line, index) => <fieldset className={`line-item${taxOptions ? ' line-item-simple' : ''}`} key={index}>
      <legend>Line {index + 1}</legend>
      {fields.filter(key => !taxOptions || key !== 'tax_rate').map(key => <label key={key}>{captions[key]}{renderInput(line, index, key)}</label>)}
      <button type="button" className="remove-line" aria-label={`Remove line ${index + 1}${line.description ? ': ' + line.description : ''}`} onClick={() => {
        setRemoved({ line, index })
        onChange(lines.length === 1 ? [makeLine()] : lines.filter((_, i) => i !== index))
        queueMicrotask(() => undo.current?.focus())
      }}>×</button>
    </fieldset>)}
    {removed && <p role="status">Line removed. <button ref={undo} type="button" className="text-button" onClick={() => {
      const next = [...lines]
      if (lines.length === 1 && !lines[0].description && !lines[0].unit_price) next.splice(0, 1)
      next.splice(Math.min(removed.index, next.length), 0, removed.line)
      onChange(next)
      setRemoved(null)
    }}>Undo removal</button></p>}
    {taxOptions && <details className="document-tax-options">
      <summary>{taxUsed ? `Tax options · ${defaultTax}% default` : 'Tax options'}{mixedTax && ' · Line overrides'}</summary>
      <div className="form-grid">
        <label>Default tax rate (%)<input type="number" min="0" max="100" step="0.01" value={defaultTax} onChange={event => {
          const rate = event.target.value
          const updateDefault = taxDefault?.onChange ?? setLocalDefaultTax
          updateDefault(rate)
          onChange(lines.map(line => Number(line.tax_rate) === Number(defaultTax) ? { ...line, tax_rate: rate } : line))
        }} /></label>
        <p className="quiet full">The default applies to new lines and lines using the previous default. Set a different rate below when an item needs its own rate.</p>
        {lines.map((line, index) => <label key={index}>{`Line ${index + 1}${line.description ? ' · ' + line.description : ''} tax (%)`}{renderInput(line, index, 'tax_rate')}</label>)}
      </div>
    </details>}
  </div>
}

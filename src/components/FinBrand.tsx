export function FinMark({className=''}:{className?:string}) {
 return <img className={`fin-mark ${className}`} src="/finviant-mark.svg" alt="" aria-hidden="true" />
}
export function FinName(){return <span className="fin-name" aria-hidden="true"><FinMark/>in</span>}
export default function FinBrand(){return <div className="fin-brand" aria-label="Finviant AI Office Assistant"><FinMark/><span>AI Office Assistant</span></div>}

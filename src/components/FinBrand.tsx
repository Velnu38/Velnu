export function FinMark({className='',onDark=false}:{className?:string;onDark?:boolean}) {
 return <img className={`fin-mark ${className}`} src={onDark?'/finviant-mark-on-dark.svg':'/finviant-mark.svg'} alt="" aria-hidden="true" />
}
export function FinName({onDark=false}:{onDark?:boolean}){return <span className="fin-name" aria-hidden="true"><FinMark onDark={onDark}/>in</span>}
export default function FinBrand(){return <div className="fin-brand" aria-label="Finviant AI Office Assistant"><FinMark/><span>AI Office Assistant</span></div>}

import type {ButtonHTMLAttributes} from 'react'
import {FinMark} from './FinBrand'
import './fin-action-button.css'
/** One visual treatment for task help, voice entry, and sending a request to Fin. */
export default function FinActionButton({className='',working=false,...props}:Omit<ButtonHTMLAttributes<HTMLButtonElement>,'children'>&{working?:boolean}){
 return <button type="button" {...props} className={`fin-action-button ${className}`}><FinMark onDark/><span>{working?'Working…':'Ask Fin'}</span></button>
}

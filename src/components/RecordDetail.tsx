import {Children,Fragment,isValidElement,useEffect,useRef,useState,type KeyboardEvent,type ReactNode} from 'react'
import './record-detail.css'

export function RecordDetailHeader({title,eyebrow,subtitle,status,children}:{title:ReactNode;eyebrow?:string;subtitle?:ReactNode;status?:ReactNode;children?:ReactNode}){
 return <header className="record-detail-header"><div className="record-detail-heading">{eyebrow&&<p className="eyebrow">{eyebrow}</p>}<div className="record-detail-title"><h2>{title}</h2>{status&&<div className="record-detail-status">{status}</div>}</div>{subtitle&&<div className="record-detail-subtitle">{subtitle}</div>}</div>{children&&<div className="record-detail-header-extra">{children}</div>}</header>
}

export type RecordTab={id:string;label:string;badge?:ReactNode}
function hasContent(value:ReactNode):boolean{
 return Children.toArray(value).some(child=>isValidElement<{children?:ReactNode}>(child)&&child.type===Fragment?hasContent(child.props.children):child!==null&&child!==undefined&&child!=='')
}
/** Each id also names its caller-owned `${id}-panel` tab panel. */
export function RecordTabs({tabs,active,onChange,label='Record sections'}:{tabs:RecordTab[];active:string;onChange:(id:string)=>void;label?:string}){
 function navigate(event:KeyboardEvent<HTMLButtonElement>,index:number){
  const next=event.key==='ArrowRight'?(index+1)%tabs.length:event.key==='ArrowLeft'?(index-1+tabs.length)%tabs.length:event.key==='Home'?0:event.key==='End'?tabs.length-1:null
  if(next===null)return
  event.preventDefault();onChange(tabs[next].id);document.getElementById(tabs[next].id+'-tab')?.focus()
 }
 return <div className="record-tabs" role="tablist" aria-label={label}>{tabs.map((tab,index)=><button key={tab.id} id={tab.id+'-tab'} type="button" role="tab" aria-selected={active===tab.id} aria-controls={tab.id+'-panel'} tabIndex={active===tab.id?0:-1} onClick={()=>onChange(tab.id)} onKeyDown={event=>navigate(event,index)}>{tab.label}{tab.badge!==undefined&&<span className="record-tab-badge">{tab.badge}</span>}</button>)}</div>
}

/** Native disclosure keeps ordinary buttons and links keyboard accessible. */
export function RecordMoreMenu({children,label='More',disabled=false,className='',contentClassName=''}:{children:ReactNode;label?:string;disabled?:boolean;className?:string;contentClassName?:string}){
 const ref=useRef<HTMLDetailsElement>(null),[open,setOpen]=useState(false)
 useEffect(()=>{
  if(!open)return
  const dismiss=(event:PointerEvent)=>{if(event.target instanceof Node&&!ref.current?.contains(event.target))ref.current?.removeAttribute('open')}
  document.addEventListener('pointerdown',dismiss)
  return()=>document.removeEventListener('pointerdown',dismiss)
 },[open])
 if(!hasContent(children))return null
 return <details ref={ref} className={'record-more '+className} onToggle={event=>setOpen(event.currentTarget.open)} onKeyDown={event=>{if(event.key==='Escape'&&ref.current?.open){event.preventDefault();event.stopPropagation();ref.current.open=false;ref.current.querySelector('summary')?.focus()}}}>
  <summary aria-disabled={disabled||undefined} tabIndex={disabled?-1:0} onClick={event=>{if(disabled)event.preventDefault()}}>{label}<span aria-hidden="true">⌄</span></summary>
  <div className={'record-more-content '+contentClassName} role="group" aria-label={label==='More'?'More actions':label} onClick={event=>{const target=(event.target as Element).closest('button,a');if(target&&!target.hasAttribute('disabled')&&!target.hasAttribute('data-keep-menu')&&!target.hasAttribute('data-keep-dialog')&&!event.defaultPrevented&&ref.current)ref.current.open=false}}>{children}</div>
 </details>
}

/** Callers provide one primary action and, when needed, one secondary action. */
export function RecordActionBar({primary,secondary,more,moreLabel='More',disabled=false,children}:{primary:ReactNode;secondary?:ReactNode;more?:ReactNode;moreLabel?:string;disabled?:boolean;children?:ReactNode}){
 return <section className="record-action-bar" aria-label="Record actions"><div className="record-action-controls">{primary&&<div className="record-action-primary">{primary}</div>}{secondary&&<div className="record-action-secondary">{secondary}</div>}{more&&<RecordMoreMenu label={moreLabel} disabled={disabled}>{more}</RecordMoreMenu>}</div>{children&&<div className="record-action-feedback">{children}</div>}</section>
}

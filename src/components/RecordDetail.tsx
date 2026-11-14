import {Children,Fragment,isValidElement,useEffect,useRef,useState,type ReactNode} from 'react'
import * as Tabs from '@radix-ui/react-tabs'
import './record-detail.css'

export function RecordDetailHeader({title,eyebrow,subtitle,status,children}:{title:ReactNode;eyebrow?:string;subtitle?:ReactNode;status?:ReactNode;children?:ReactNode}){
 return <header className="record-detail-header"><div className="record-detail-heading">{eyebrow&&<p className="eyebrow">{eyebrow}</p>}<div className="record-detail-title"><h2>{title}</h2>{status&&<div className="record-detail-status">{status}</div>}</div>{subtitle&&<div className="record-detail-subtitle">{subtitle}</div>}</div>{children&&<div className="record-detail-header-extra">{children}</div>}</header>
}

export type RecordTab={id:string;label:string;badge?:ReactNode;disabled?:boolean}
function hasContent(value:ReactNode):boolean{
 return Children.toArray(value).some(child=>isValidElement<{children?:ReactNode}>(child)&&child.type===Fragment?hasContent(child.props.children):child!==null&&child!==undefined&&child!=='')
}
/**
 * Radix owns keyboard navigation and the roving tab stop. The caller retains
 * selection and panel lifecycle so drafts, lazy records and permissions survive.
 * Explicit IDs preserve the existing caller-owned `${id}-panel` relationships.
 */
export function RecordTabs({tabs,active,onChange,label='Record sections',dir}:{tabs:RecordTab[];active:string;onChange:(id:string)=>void;label?:string;dir?:'ltr'|'rtl'}){
 return <Tabs.Root asChild dir={dir} value={active} onValueChange={onChange} activationMode="automatic">
  <Tabs.List className="record-tabs" aria-label={label} loop>
   {tabs.map(tab=><Tabs.Trigger key={tab.id} value={tab.id} id={tab.id+'-tab'} aria-controls={tab.id+'-panel'} disabled={tab.disabled}
    // Native/programmatic click activation must work too; pointer/focus normally
    // selects through Radix before click, so do not request an already active tab.
    onClick={()=>{if(active!==tab.id)onChange(tab.id)}}>
     {tab.label}{tab.badge!==undefined&&<span className="record-tab-badge">{tab.badge}</span>}
   </Tabs.Trigger>)}
  </Tabs.List>
 </Tabs.Root>
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

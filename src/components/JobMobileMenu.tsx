import type { ReactNode } from 'react'

export const JOB_PHONE_QUERY = '(max-width: 900px), (max-width: 1100px) and (pointer: coarse)'

export function JobMenuIcon({kind}:{kind:string}) {
  const paths:Record<string,ReactNode>={
    tasks:<><path d="M9 5H5v16h14V5h-4M9 3h6v4H9zM8 12l2 2 5-5M8 18h8"/></>,
    schedule:<><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 11h18m-13 5h3m3 0h3"/></>,
    materials:<><path d="m12 2 9 5v10l-9 5-9-5V7l9-5Zm0 10 9-5M12 12 3 7m9 5v10M7 5l10 5"/></>,
    photos:<><path d="M3 7h4l2-3h6l2 3h4v14H3z"/><circle cx="12" cy="14" r="4"/></>,
    billing:<><path d="M6 2h8l5 5v15H6zM14 2v6h5M9 12h7m-7 4h7"/></>,
    costs:<><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 4 16 4 16 0V5M4 11v6c0 4 16 4 16 0v-6"/></>,
    changes:<><path d="M3 7h17l-4-4m4 4-4 4M21 17H4l4-4m-4 4 4 4"/></>,
    activity:<><circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 3"/></>,
    reports:<><path d="M8 4H5v18h14V4h-3M8 2h8v5H8zM8 13l3 3 5-6"/></>,
  }
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[kind]||paths.billing}</svg>
}

export type JobMenuItem={key:string;label:string;description:string;icon?:string;onClick:()=>void}
export default function JobMobileMenu({title,items,children}:{title:string;items:JobMenuItem[];children?:ReactNode}){
 return <section className="jm-mobile-menu" aria-label={title}>
   <h3>{title}</h3>
   {children}
   <div className={'jm-quick-grid'+(items.length!==4?' jm-quick-rows':'')}>
     {items.map(item=><button key={item.key} type="button" className="jm-quick-tile" onClick={item.onClick}>
       <JobMenuIcon kind={item.icon||item.key}/><span><strong>{item.label}</strong><small>{item.description}</small></span><span aria-hidden="true" className="jm-tile-chevron">›</span>
     </button>)}
   </div>
 </section>
}

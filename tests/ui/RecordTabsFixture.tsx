import {useState} from 'react'
import {RecordTabs} from '../../src/components/RecordDetail'

/** Local/CI-only interaction fixture, never a production route. */
export default function RecordTabsFixture(){
 const [active,setActive]=useState('sample-details'),[guard,setGuard]=useState(false),[draft,setDraft]=useState(''),[submitted,setSubmitted]=useState(false),[rtl,setRtl]=useState(false)
 const tabs=[{id:'sample-details',label:'Details'},{id:'sample-disabled',label:'Unavailable',disabled:true},{id:'sample-photos',label:'Photos & expenses'},{id:'sample-activity',label:'Activity',badge:3}]
 return <main><h1>Shared record tabs · synthetic data</h1><label><input type="checkbox" checked={guard} onChange={event=>setGuard(event.target.checked)}/>Keep current section</label><label><input type="checkbox" checked={rtl} onChange={event=>setRtl(event.target.checked)}/>Right-to-left navigation</label><form onSubmit={event=>{event.preventDefault();setSubmitted(true)}}>
  <RecordTabs dir={rtl?'rtl':'ltr'} tabs={tabs} active={active} onChange={next=>{if(!guard)setActive(next)}} label="Synthetic record sections"/>
  {tabs.filter(tab=>!tab.disabled).map(tab=><section key={tab.id} role="tabpanel" id={tab.id+'-panel'} aria-labelledby={tab.id+'-tab'} hidden={active!==tab.id}>
   {tab.id==='sample-details'?<label>Unsaved note<textarea value={draft} onChange={event=>setDraft(event.target.value)}/></label>:<p>{tab.label} · synthetic record</p>}
  </section>)}
  <output aria-label="Form submission">{submitted?'Submitted':'Not submitted'}</output>
 </form></main>
}

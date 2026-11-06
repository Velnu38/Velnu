import {useEffect,useState} from 'react'
import {getTierUsage,type TierUsage} from '../services/tiers'
import {monthlyPlans} from '../lib/pricing'
import './settings/tiers.css'
export default function TierBanner({businessId}:{businessId:string}){
 const[state,setState]=useState<TierUsage|null>(null)
 useEffect(()=>{let active=true;const refresh=()=>{void getTierUsage(businessId).then(s=>{if(active)setState(s)}).catch(()=>{if(active)setState(null)})};refresh();window.addEventListener('finviant-tier-changed',refresh);return()=>{active=false;window.removeEventListener('finviant-tier-changed',refresh)}},[businessId])
 return state?.testing?<div className="tier-banner" role="status"><strong>Testing {monthlyPlans[state.plan].name}</strong><span>Real plan limits · No subscription charge</span><a href="/?view=settings&section=plans">Change or restore tier</a></div>:null
}

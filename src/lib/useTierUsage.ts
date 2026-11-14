import {useEffect,useState} from 'react'
import {getTierUsage,type TierUsage} from '../services/tiers'
export function useTierUsage(businessId:string){
 const[state,setState]=useState<TierUsage|null>(null)
 useEffect(()=>{let active=true;const load=()=>{void getTierUsage(businessId).then(s=>{if(active)setState(s)}).catch(()=>{if(active)setState(null)})};load();const visible=()=>{if(!document.hidden)load()};for(const event of ['finviant-tier-changed','finviant-delivery-changed','focus'])window.addEventListener(event,visible);document.addEventListener('visibilitychange',visible);return()=>{active=false;for(const event of ['finviant-tier-changed','finviant-delivery-changed','focus'])window.removeEventListener(event,visible);document.removeEventListener('visibilitychange',visible)}},[businessId]);return state
}

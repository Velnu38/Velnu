import {useEffect,useState} from 'react'
import {getTierUsage,type TierUsage} from '../services/tiers'
export function useTierUsage(businessId:string){
 const[state,setState]=useState<TierUsage|null>(null)
 useEffect(()=>{let active=true;const load=()=>{void getTierUsage(businessId).then(s=>{if(active)setState(s)}).catch(()=>{if(active)setState(null)})};load();window.addEventListener('finviant-tier-changed',load);return()=>{active=false;window.removeEventListener('finviant-tier-changed',load)}},[businessId]);return state
}

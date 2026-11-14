export default function UsageMeter({label,used=0,limit}:{label:string;used?:number;limit:number|null}){
 const full=limit!==null&&limit>0&&used>=limit,near=limit!==null&&limit>0&&used>=limit*.8
 return <div><strong>{label}</strong><span>{limit===0?'Not included':`${used} / ${limit===null?'No count cap':limit}`}</span>{limit!==null&&limit>0&&<progress aria-label={label+' used'} value={Math.min(used,limit)} max={limit}/>}{(full||near)&&<small role="status">{full?'Allowance reached. Existing records remain available.':'At least 80% used.'}</small>}</div>
}

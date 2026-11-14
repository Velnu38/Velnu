export default function EstimatePaymentTerms({value,onChange,disabled=false}:{value:string;onChange:(value:string)=>void;disabled?:boolean}){
 const days=['0','7','15','30','60','90']
 return <label>Invoice payment terms<select value={value} disabled={disabled} onChange={e=>onChange(e.target.value)}><option value="">Choose when reviewing the final invoice</option><option value="0">Due on issue</option>{days.slice(1).map(d=><option key={d} value={d}>Net {d} days</option>)}{value&&!days.includes(value)&&<option value={value}>Net {value} days</option>}</select><small>Shown on the estimate and carried into the final draft. Existing agreed terms stay with their issued document.</small></label>
}

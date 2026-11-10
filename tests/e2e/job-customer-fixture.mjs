// Only synthetic API fixture rows; actual search and authorization run in SQL/Auth tests.
export function customerSearchResponse(rows,p={}){
 const norm=s=>(s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase().replace(/\s+/g,' '),q=norm(p.p_query),digits=q.replace(/\D/g,'');
 const active=rows.filter(c=>!c.archived),shape=c=>Object.fromEntries(['id','first_name','last_name','company','email','phone'].map(k=>[k,c[k]??null]));
 const scored=active.map(c=>{const fields=[[c.first_name,c.last_name].filter(Boolean).join(' ')||c.company||'Customer',c.company,c.email,c.phone].map(norm);return {c,score:!q?1:fields.includes(q)?3:fields.some(f=>f.startsWith(q))?2:q.split(' ').every(t=>fields.some(f=>f.includes(t)))||digits.length>=3&&/^[\d\s()+.-]+$/.test(q)&&(c.phone||'').replace(/\D/g,'').includes(digits)?1:0}}).filter(s=>s.score).sort((a,b)=>b.score-a.score);
 return {items:scored.slice(0,8).map(s=>shape(s.c)),selected:active.some(c=>c.id===p.p_selected)?shape(active.find(c=>c.id===p.p_selected)):null};
}

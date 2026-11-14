export function paymentTermsText(days:number){return 'Invoice payment terms: '+(days===0?'Due on issue.':`Net ${days} days.`)}
export function withoutPaymentTerms(message:string,days:number|null|undefined){if(days==null)return message;const text=paymentTermsText(days);return (message===text?'':message.replaceAll('\n\n'+text,'')).trim()}
export function estimatePaymentMessage(message:string,days:string){return days===''?message.trim():[message.trim(),paymentTermsText(Number(days))].filter(Boolean).join('\n\n')}

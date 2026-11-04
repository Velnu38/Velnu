/** Formatting is not proof of ownership; Auth must confirm an SMS code. */
export function normalizeMobile(value:string):string|null{
 const trimmed=value.trim();if(!trimmed||!/^[+\d\s().-]+$/.test(trimmed))return null
 const digits=trimmed.replace(/[\s().-]/g,'')
 const normalized=digits.startsWith('+')?digits:/^\d{10}$/.test(digits)?'+1'+digits:/^1\d{10}$/.test(digits)?'+'+digits:''
 return /^\+[1-9]\d{7,14}$/.test(normalized)?normalized:null
}

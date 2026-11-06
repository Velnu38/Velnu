import {normalizeMobile} from './smsPhone'
export function personalEmailHref(email:string,subject:string,body:string){
 if(!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(email.trim())||/[\r\n]/.test(email))throw new Error('A valid recipient email is required.')
 return 'mailto:'+encodeURIComponent(email.trim())+'?subject='+encodeURIComponent(subject.replace(/[\r\n]+/g,' '))+'&body='+encodeURIComponent(body)
}
export function personalSmsHref(phone:string,body:string,userAgent=typeof navigator==='undefined'?'':navigator.userAgent){
 const number=normalizeMobile(phone);if(!number)throw new Error('A valid mobile number is required.')
 return 'sms:'+number+(/iPad|iPhone|iPod/.test(userAgent)?'&':'?')+'body='+encodeURIComponent(body)
}
export function createShareToken(){return Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('')}

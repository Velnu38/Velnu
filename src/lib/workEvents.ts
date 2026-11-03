/** Lightweight invalidation signal, safe for eagerly loaded document services. */
export function announceCalendarChange() {
 if(typeof window!=='undefined')window.dispatchEvent(new Event('finviant-work-changed'))
}

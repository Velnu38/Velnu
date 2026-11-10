import type { SupabaseClient } from '@supabase/supabase-js'

/** Realtime payloads are invalidation hints only; every refresh rechecks normal RLS. */
export function listenToBusinessChanges(client: SupabaseClient, businessId: string, notify: () => void) {
  let channel = client.channel('finviant-business:' + businessId)
  // The signal contains no customer details, financial amounts, or document data.
  // Do not subscribe broadly to raw financial rows from a worker's workspace.
  for (const event of ['INSERT', 'UPDATE'] as const) channel = channel.on('postgres_changes', {
    event, schema: 'public', table: 'business_activity', filter: 'business_id=eq.' + businessId,
  }, notify)
  channel.subscribe(status => { if (status === 'SUBSCRIBED') notify() })
  return () => { void client.removeChannel(channel).catch(() => {}) }
}

type Refresh = () => unknown | Promise<unknown>
type Environment = {
  window: Pick<Window, 'addEventListener' | 'removeEventListener' | 'setInterval' | 'clearInterval' | 'setTimeout' | 'clearTimeout'>
  document: Pick<Document, 'hidden' | 'addEventListener' | 'removeEventListener'>
  isEditing: () => boolean
  listen: (businessId: string, notify: () => void) => () => void
}

/** One transport per business, shared by visible read views and dashboard widgets. */
export function createBusinessRefreshCoordinator(environment: Environment) {
  const hubs = new Map<string, { add: (refresh: Refresh) => () => void; stop: () => void; size: () => number }>()
  return {
    subscribe(businessId: string, refresh: Refresh) {
      if (!/^[a-f0-9-]{36}$/i.test(businessId)) return () => {}
      let hub = hubs.get(businessId)
      if (!hub) {
        const listeners = new Map<Refresh, { busy: boolean; pending: boolean }>()
        let stopped = false
        let deferred = false
        let timer: number | undefined
        const flush = () => {
          timer = undefined
          if (stopped) return
          if (environment.document.hidden || environment.isEditing()) { deferred = true; return }
          deferred = false
          for (const [listener, state] of listeners) {
            if (state.busy) { state.pending = true; continue }
            state.busy = true; state.pending = false
            void Promise.resolve().then(() => {
              if (stopped || !listeners.has(listener)) return
              if (environment.document.hidden || environment.isEditing()) { deferred = true; return }
              return listener()
            }).catch(() => { /* The read view owns its visible error state. Polling can retry. */ })
              .finally(() => {
                state.busy = false
                if (state.pending && !stopped) notify()
              })
          }
        }
        const notify = () => {
          if (!stopped && timer === undefined) timer = environment.window.setTimeout(flush, 150)
        }
        const onLocal = (event: Event) => {
          const changedBusiness = (event as CustomEvent<{ businessId?: string }>).detail?.businessId
          if (!changedBusiness || changedBusiness === businessId) notify()
        }
        const onEditingIdle = () => { if (deferred) notify() }
        const stopRealtime = environment.listen(businessId, notify)
        const poll = environment.window.setInterval(notify, 30000)
        environment.window.addEventListener('focus', notify)
        environment.window.addEventListener('finviant-work-changed', onLocal)
        environment.window.addEventListener('finviant-editing-idle', onEditingIdle)
        environment.document.addEventListener('visibilitychange', notify)
        hub = {
          add(listener) {
            listeners.set(listener, { busy: false, pending: false })
            return () => { listeners.delete(listener) }
          },
          size: () => listeners.size,
          stop() {
            stopped = true
            stopRealtime()
            if (timer !== undefined) environment.window.clearTimeout(timer)
            environment.window.clearInterval(poll)
            environment.window.removeEventListener('focus', notify)
            environment.window.removeEventListener('finviant-work-changed', onLocal)
            environment.window.removeEventListener('finviant-editing-idle', onEditingIdle)
            environment.document.removeEventListener('visibilitychange', notify)
            listeners.clear()
          },
        }
        hubs.set(businessId, hub)
      }
      const remove = hub.add(refresh)
      return () => {
        remove()
        if (hub.size() === 0) { hub.stop(); hubs.delete(businessId) }
      }
    },
  }
}

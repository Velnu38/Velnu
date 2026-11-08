import { useEffect, useRef } from 'react'
import { supabase } from './supabase'
import { hasUnsavedChanges } from './unsavedChanges'
import { createBusinessRefreshCoordinator, listenToBusinessChanges } from './businessRefreshHub'

let shared: ReturnType<typeof createBusinessRefreshCoordinator> | undefined

/** Refresh read data after customer actions; never remount pages or overwrite active editors. */
export function useBusinessRefresh(businessId: string, refresh: () => unknown | Promise<unknown>, enabled = true) {
  const current = useRef(refresh)
  current.current = refresh
  useEffect(() => {
    if (!enabled) return
    shared ??= createBusinessRefreshCoordinator({
      window, document, isEditing: hasUnsavedChanges,
      listen: (business, notify) => listenToBusinessChanges(supabase, business, notify),
    })
    return shared.subscribe(businessId, () => current.current())
  }, [businessId, enabled])
}

import { useCallback, useEffect, useRef, useState } from 'react'
import { getDeliverySetup, type DeliverySetup } from '../services/tiers'

/** Phone tabs must refresh server-side sending access when they become active. */
export function useDeliverySetup(businessId: string | undefined) {
  const [setup, setSetup] = useState<DeliverySetup | null>(null)
  const [error, setError] = useState('')
  const mounted = useRef(false)
  const generation = useRef(0)
  const refresh = useCallback(async () => {
    if (!businessId) throw new Error('Save your company profile before sending.')
    const request = ++generation.current
    try {
      const value = await getDeliverySetup(businessId)
      if (mounted.current && request === generation.current) {
        setSetup(value)
        setError('')
      }
      return value
    } catch (err) {
      if (mounted.current && request === generation.current) {
        setError(err instanceof Error ? err.message : 'Unable to check sending options.')
      }
      throw err
    }
  }, [businessId])

  useEffect(() => {
    mounted.current = true
    setSetup(null)
    setError('')
    const load = () => { if (businessId) void refresh().catch(() => {}) }
    const visible = () => { if (document.visibilityState !== 'hidden') load() }
    load()
    for (const event of ['finviant-tier-changed', 'finviant-delivery-changed', 'focus']) window.addEventListener(event, load)
    document.addEventListener('visibilitychange', visible)
    return () => {
      mounted.current = false
      ++generation.current
      for (const event of ['finviant-tier-changed', 'finviant-delivery-changed', 'focus']) window.removeEventListener(event, load)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [refresh])

  return { setup, error, refresh }
}

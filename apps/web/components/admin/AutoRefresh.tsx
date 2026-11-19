'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { hasDirty, shouldRefresh } from '@/lib/admin/dirty'

const INTERVAL_MS = 45_000

/**
 * Keeps the Orders badge and Overview current without a manual reload:
 * re-fetches the server components every 45 s while the tab is visible, and
 * at once when it becomes visible again. Skips while a price edit is unsaved.
 */
export function AutoRefresh() {
  const router = useRouter()

  useEffect(() => {
    const tick = () => {
      if (shouldRefresh(document.visibilityState === 'visible', hasDirty())) router.refresh()
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') tick()
    }
    const timer = window.setInterval(tick, INTERVAL_MS)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [router])

  return null
}

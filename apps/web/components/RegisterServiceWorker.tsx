'use client'

import { useEffect } from 'react'
import { startInstallListener } from '@/lib/pwa/install'

/** Registers the offline copy in the production build only; dev and tests never get a worker. */
export function RegisterServiceWorker() {
  useEffect(() => {
    startInstallListener()
    if (process.env.NODE_ENV !== 'production') return
    if (!('serviceWorker' in navigator) || !window.isSecureContext) return
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
      /* the site works the same without the offline copy */
    })
  }, [])
  return null
}

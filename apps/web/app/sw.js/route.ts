import { serviceWorkerSource } from '@/lib/pwa/sw-source'

// Evaluated once at build time, so BUILD_ID changes with every deploy and so does the worker's cache name.
export const dynamic = 'force-static'

const BUILD_ID = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) || `local-${Date.now().toString(36)}`

export function GET() {
  return new Response(serviceWorkerSource(BUILD_ID), {
    headers: {
      'content-type': 'text/javascript; charset=utf-8',
      // The browser must re-check the worker on every visit, or a deploy never reaches installed apps.
      'cache-control': 'no-cache, max-age=0',
      'service-worker-allowed': '/',
    },
  })
}

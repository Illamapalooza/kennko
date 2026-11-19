import { adminManifest } from '@/lib/pwa/manifests'

// A route handler (not app/manifest.ts) because that convention only exists at the app root,
// and the admin app needs its own scope and start_url.
export const dynamic = 'force-static'

export function GET() {
  return new Response(JSON.stringify(adminManifest), {
    headers: { 'content-type': 'application/manifest+json; charset=utf-8' },
  })
}

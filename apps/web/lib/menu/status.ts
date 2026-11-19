import 'server-only'
import { getServerClient } from '@/lib/supabase/server'

export type MenuStatus =
  | { ok: true; publishedVersion: number | null; publishedAt: string | null; hasUnpublishedChanges: boolean }
  | { ok: false }

/**
 * Asks the API whether the draft menu differs from the published one. Uses the signed-in user's
 * access token. Never throws: any failure is `{ ok: false }`.
 */
export async function getMenuStatus(): Promise<MenuStatus> {
  const base = process.env.KENNKO_API_URL
  if (!base) return { ok: false }

  try {
    const db = await getServerClient()
    const token = (await db.auth.getSession()).data.session?.access_token
    if (!token) return { ok: false }

    const res = await fetch(`${base.replace(/\/+$/, '')}/v1/menu/status`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return { ok: false }

    const body = (await res.json().catch(() => null)) as {
      publishedVersion?: unknown
      publishedAt?: unknown
      hasUnpublishedChanges?: unknown
    } | null
    if (!body || typeof body.hasUnpublishedChanges !== 'boolean') return { ok: false }

    return {
      ok: true,
      publishedVersion: typeof body.publishedVersion === 'number' ? body.publishedVersion : null,
      publishedAt: typeof body.publishedAt === 'string' ? body.publishedAt : null,
      hasUnpublishedChanges: body.hasUnpublishedChanges,
    }
  } catch {
    return { ok: false }
  }
}

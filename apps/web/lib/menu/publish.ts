import 'server-only'
import { staffFetch } from '@/lib/api/client'

export type PublishResult = { ok: true; version: number } | { ok: false; message: string }

/**
 * Asks the API to publish the current menu as the snapshot the website and till read. Uses the
 * signed-in user's access token. Never throws for an API or network failure.
 */
export async function publishMenu(): Promise<PublishResult> {
  try {
    const res = await staffFetch('/v1/menu/publish', { method: 'POST' })
    const body = (await res.json().catch(() => null)) as
      | { version?: number; message?: string }
      | null

    if (!res.ok) {
      return { ok: false, message: body?.message ?? `The menu API responded ${res.status}.` }
    }
    if (typeof body?.version !== 'number') {
      return { ok: false, message: 'The menu API sent an unexpected answer.' }
    }
    return { ok: true, version: body.version }
  } catch (cause) {
    return {
      ok: false,
      message: cause instanceof Error ? cause.message : 'Could not reach the menu API.',
    }
  }
}

import * as webpush from 'web-push'

export type PushPayload = { title: string; body: string; url: string; tag: string }
export type PushTarget = { endpoint: string; p256dh: string; auth: string }
export type PushOutcome = 'sent' | 'gone' | 'failed'
export type PushSender = (sub: PushTarget, payload: PushPayload) => Promise<PushOutcome>
export type Vapid = { publicKey: string; privateKey: string; subject: string }

/** Order updates are stale after a few hours; let the push service drop them after that. */
const TTL_SECONDS = 4 * 60 * 60
/** A hung push service must not hold a request open. */
const TIMEOUT_MS = 5000

export function createPushSender(vapid: Vapid): PushSender {
  webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey)
  return async (sub, payload) => {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload),
        { TTL: TTL_SECONDS, timeout: TIMEOUT_MS },
      )
      return 'sent'
    } catch (err) {
      const status = (err as { statusCode?: number } | null)?.statusCode
      if (status === 404 || status === 410) return 'gone'
      console.error('web push failed', status ?? '', err instanceof Error ? err.message : err)
      return 'failed'
    }
  }
}

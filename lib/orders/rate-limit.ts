type Bucket = { count: number; resetAt: number }

const buckets = new Map<string, Bucket>()

const WINDOW_MS = 10 * 60 * 1000
const MAX_PER_WINDOW = 8

/**
 * In-memory sliding window. Enough to stop a script hammering the upload
 * endpoint from one address; a serious attacker across many IPs needs an
 * edge-level control, which is a deployment concern rather than a code one.
 */
export function allowRequest(key: string, now = Date.now()): boolean {
  const bucket = buckets.get(key)

  if (!bucket || now >= bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS })
    return true
  }

  if (bucket.count >= MAX_PER_WINDOW) return false

  bucket.count += 1
  return true
}

export function resetRateLimit() {
  buckets.clear()
}

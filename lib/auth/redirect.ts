/**
 * Only same-origin paths survive. Without this, `?next=https://evil.example`
 * would bounce a customer straight from a successful sign-in to an attacker's
 * page, with the Kennko sign-in as the referrer.
 */
export function safeNextPath(raw: string | null, fallback = '/orders'): string {
  if (!raw) return fallback
  // "//host" is protocol-relative and leaves the origin; "/\host" does too in
  // some browsers, which is why backslashes are rejected outright.
  if (!raw.startsWith('/')) return fallback
  if (raw.startsWith('//')) return fallback
  if (raw.includes('\\')) return fallback
  if (raw.includes('://')) return fallback
  return raw
}

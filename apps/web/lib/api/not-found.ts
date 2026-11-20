/**
 * A 404 means "no such order" only when the API says so (`{ code: 'NOT_FOUND' }`). A bare 404 — an
 * older API without the route, a wrong host — is a failure, so the page shows its error boundary.
 */
export async function isNoSuchOrder(res: Response): Promise<boolean> {
  if (res.status !== 404) return false
  const body = (await res.json().catch(() => null)) as { code?: unknown } | null
  return body?.code === 'NOT_FOUND'
}

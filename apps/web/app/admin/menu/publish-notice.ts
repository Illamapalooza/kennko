// Plain module (not 'use server'): builds and reads the redirect that carries a publish failure.
// Server action errors are hidden in production, so the message travels in the URL instead.

export function publishFailureCopy(message: string): string {
  return `Saved, but the menu could not be published: ${message}. Press Publish menu to try again.`
}

export function publishFailedUrl(message: string): string {
  return `/admin/menu?publish=failed&reason=${encodeURIComponent(message)}`
}

export function readPublishNotice(params: {
  publish?: string | string[]
  reason?: string | string[]
}): string | null {
  if (params.publish !== 'failed') return null
  const reason = Array.isArray(params.reason) ? params.reason[0] : params.reason
  return publishFailureCopy(reason || 'Unknown error')
}

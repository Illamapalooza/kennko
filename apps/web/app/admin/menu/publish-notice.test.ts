import { describe, expect, it } from 'vitest'
import { publishFailedUrl, publishFailureCopy, readPublishNotice } from './publish-notice'

describe('publish notice', () => {
  it('builds a redirect URL with the encoded reason', () => {
    expect(publishFailedUrl('API said no & stop')).toBe(
      '/admin/menu?publish=failed&reason=API%20said%20no%20%26%20stop',
    )
  })

  it('round-trips the message through search params', () => {
    const url = new URL(publishFailedUrl('Bad: 100% broken'), 'http://x')
    const params = Object.fromEntries(url.searchParams)
    expect(readPublishNotice(params)).toBe(publishFailureCopy('Bad: 100% broken'))
  })

  it('uses the exact copy', () => {
    expect(publishFailureCopy('boom')).toBe(
      'Saved, but the menu could not be published: boom. Press Publish menu to try again.',
    )
  })

  it('returns null without publish=failed', () => {
    expect(readPublishNotice({})).toBeNull()
    expect(readPublishNotice({ reason: 'x' })).toBeNull()
  })
})

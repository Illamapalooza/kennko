import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const webKeyFetch = vi.fn()
vi.mock('@/lib/api/client', () => ({ webKeyFetch: (...a: unknown[]) => webKeyFetch(...a) }))

const { activeStaffEmails, sendEmail } = await import('./send')

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

let error: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  webKeyFetch.mockReset()
  error = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('activeStaffEmails', () => {
  it('reads the alert list from the API with the web key', async () => {
    webKeyFetch.mockResolvedValue(json(200, { emails: ['a@x.test', 'b@x.test'] }))
    expect(await activeStaffEmails()).toEqual(['a@x.test', 'b@x.test'])
    expect(webKeyFetch).toHaveBeenCalledWith('/v1/staff/alert-emails')
    expect(error).not.toHaveBeenCalled()
  })

  it('no key configured (null): [] with a log line', async () => {
    webKeyFetch.mockResolvedValue(null)
    expect(await activeStaffEmails()).toEqual([])
    expect(error).toHaveBeenCalledWith('[email] staff alert list unavailable')
  })

  it.each([401, 503, 500])('a %s: [] with a log line', async (status) => {
    webKeyFetch.mockResolvedValue(json(status, { code: 'X' }))
    expect(await activeStaffEmails()).toEqual([])
    expect(error).toHaveBeenCalledWith('[email] staff alert list unavailable')
  })

  it('a throw or a malformed body: [] with a log line', async () => {
    webKeyFetch.mockRejectedValue(new Error('network'))
    expect(await activeStaffEmails()).toEqual([])
    webKeyFetch.mockResolvedValue(json(200, { emails: 'nope' }))
    expect(await activeStaffEmails()).toEqual([])
    expect(error).toHaveBeenCalledTimes(2)
  })
})

describe('sendEmail with no recipients', () => {
  it('returns early without calling Resend', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const prev = process.env.RESEND_API_KEY
    process.env.RESEND_API_KEY = 're_test'
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      expect(await sendEmail({ to: [], subject: 'New order', text: 'x' })).toBe(false)
    } finally {
      if (prev === undefined) delete process.env.RESEND_API_KEY
      else process.env.RESEND_API_KEY = prev
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

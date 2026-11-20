import { beforeEach, describe, expect, it, vi } from 'vitest'

const sendNotification = vi.fn()
const setVapidDetails = vi.fn()
vi.mock('web-push', () => ({ sendNotification, setVapidDetails }))

const { createPushSender } = await import('../src/push/send.js')

const target = { endpoint: 'https://push.test/e', p256dh: 'p', auth: 'a' }
const payload = { title: 't', body: 'b', url: '/order/KNK-1', tag: 'order-KNK-1' }
const err = (statusCode: number) => Object.assign(new Error('push error'), { statusCode })

describe('createPushSender', () => {
  beforeEach(() => {
    sendNotification.mockReset()
    setVapidDetails.mockReset()
  })

  it('sets VAPID details once and sends the JSON payload with a short TTL', async () => {
    sendNotification.mockResolvedValue({})
    const send = createPushSender({ publicKey: 'pub', privateKey: 'priv', subject: 'mailto:a@x.test' })
    expect(setVapidDetails).toHaveBeenCalledWith('mailto:a@x.test', 'pub', 'priv')
    expect(await send(target, payload)).toBe('sent')
    const [subscription, body, options] = sendNotification.mock.calls[0]!
    expect(subscription).toEqual({ endpoint: target.endpoint, keys: { p256dh: 'p', auth: 'a' } })
    expect(JSON.parse(body)).toEqual(payload)
    expect(options.TTL).toBeGreaterThan(0)
    expect(options.TTL).toBeLessThanOrEqual(6 * 60 * 60)
  })

  it.each([404, 410])('status %i -> gone', async (status) => {
    sendNotification.mockRejectedValue(err(status))
    const send = createPushSender({ publicKey: 'pub', privateKey: 'priv', subject: 'mailto:a@x.test' })
    expect(await send(target, payload)).toBe('gone')
  })

  it('status 500 and network errors -> failed', async () => {
    const send = createPushSender({ publicKey: 'pub', privateKey: 'priv', subject: 'mailto:a@x.test' })
    sendNotification.mockRejectedValue(err(500))
    expect(await send(target, payload)).toBe('failed')
    sendNotification.mockRejectedValue(new Error('ECONNRESET'))
    expect(await send(target, payload)).toBe('failed')
  })
})

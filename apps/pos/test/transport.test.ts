import { describe, expect, it, vi } from 'vitest'
import { ApiError, api, setOnLocked } from '../src/api.ts'
import { setTransport, type Transport } from '../src/transport.ts'

describe('transport', () => {
  it('routes api.menu() through the current transport', async () => {
    const call = vi.fn(async () => ({ status: 200, data: { categories: [], modifierGroups: [], source: 'built-in', updatedAt: 0 } }))
    const fake: Transport = {
      call,
      follow: () => () => {},
      download: async () => {},
    }
    setTransport(fake)
    await api.menu()
    expect(call).toHaveBeenCalledWith('GET', '/api/menu', undefined, undefined)
  })

  it('401 calls the setOnLocked handler', async () => {
    const locked = vi.fn()
    setOnLocked(locked)
    const fake: Transport = {
      call: async () => ({ status: 401, data: { error: 'Locked.' } }),
      follow: () => () => {},
      download: async () => {},
    }
    setTransport(fake)
    await expect(api.menu()).rejects.toBeInstanceOf(ApiError)
    expect(locked).toHaveBeenCalledTimes(1)
  })

  it('api.exportCsv delegates to transport.download', async () => {
    const download = vi.fn(async () => {})
    const fake: Transport = {
      call: async () => ({ status: 200, data: {} }),
      follow: () => () => {},
      download,
    }
    setTransport(fake)
    await api.exportCsv('2026-11-22')
    expect(download).toHaveBeenCalledWith('/api/report.csv?day=2026-11-22', 'kennko-sales-2026-11-22.csv')
  })
})

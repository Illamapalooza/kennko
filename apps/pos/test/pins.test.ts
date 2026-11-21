import { describe, expect, it } from 'vitest'
import { createPinDirectory } from '../till/pins.ts'

const shared = createPinDirectory({ staffPin: '1234', managerPin: '0000', staff: () => [] })

describe('shared PINs from config.json', () => {
  it('is in shared mode while a staff PIN is set', () => {
    expect(shared.mode()).toBe('shared')
  })

  it('opens the till with the staff or the manager PIN', async () => {
    expect(await shared.checkGate('1234')).toEqual({ staffId: null, name: null, role: 'staff' })
    expect(await shared.checkGate('0000')).toEqual({ staffId: null, name: null, role: 'manager' })
    expect(await shared.checkGate('9999')).toBeNull()
    expect(await shared.checkGate('')).toBeNull()
  })

  it('takes only the manager PIN for manager actions', async () => {
    expect(await shared.checkManager('0000')).toEqual({ staffId: null, name: null, role: 'manager' })
    expect(await shared.checkManager('1234')).toBeNull()
    expect(await shared.checkManager('')).toBeNull()
  })

  it('is off when the staff PIN is empty', async () => {
    const off = createPinDirectory({ staffPin: '', managerPin: '0000', staff: () => [] })
    expect(off.mode()).toBe('off')
    expect(await off.checkGate('')).toBeNull()
    expect(await off.checkManager('0000')).toEqual({ staffId: null, name: null, role: 'manager' })
  })

  it('never takes an empty PIN, even when the manager PIN is empty', async () => {
    const noManager = createPinDirectory({ staffPin: '1234', managerPin: '', staff: () => [] })
    expect(await noManager.checkGate('')).toBeNull()
    expect(await noManager.checkManager('')).toBeNull()
  })
})

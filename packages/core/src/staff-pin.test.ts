import { expect, test } from 'vitest'
import { checkStaffPin, hashStaffPin, isStaffPin, randomStaffPin } from './staff-pin.ts'

test('hash then check', async () => {
  const h = await hashStaffPin('482913')
  expect(h).toMatch(/^scrypt\$16384\$8\$1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/)
  expect(await checkStaffPin('482913', h)).toBe(true)
  expect(await checkStaffPin('482914', h)).toBe(false)
})

test('same PIN, different salt', async () => {
  expect(await hashStaffPin('111222')).not.toBe(await hashStaffPin('111222'))
})

test('bad input never throws', async () => {
  expect(await checkStaffPin('48291', await hashStaffPin('482913'))).toBe(false)
  expect(await checkStaffPin('482913', 'garbage')).toBe(false)
  expect(await checkStaffPin('482913', 'scrypt$1$1$1$a$b')).toBe(false)
  await expect(hashStaffPin('12345a')).rejects.toThrow()
})

test('tampered cost parameters are refused without hashing', async () => {
  const h = await hashStaffPin('482913')
  const [, , r, p, salt, key] = h.split('$')
  expect(await checkStaffPin('482913', ['scrypt', String(2 ** 21), r, p, salt, key].join('$'))).toBe(false)
  expect(await checkStaffPin('482913', ['scrypt', '16384', '64', p, salt, key].join('$'))).toBe(false)
  expect(await checkStaffPin('482913', ['scrypt', '16384', r, '9', salt, key].join('$'))).toBe(false)
  expect(await checkStaffPin('482913', ['scrypt', '16384', r, p, salt, key.slice(0, 20)].join('$'))).toBe(false)
})

test('random PINs are valid and never trivial', () => {
  for (let i = 0; i < 2000; i++) {
    const p = randomStaffPin()
    expect(isStaffPin(p)).toBe(true)
    expect(/^(\d)\1{5}$/.test(p) || p === '123456' || p === '654321').toBe(false)
  }
})

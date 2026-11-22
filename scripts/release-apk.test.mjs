import test from 'node:test'
import assert from 'node:assert/strict'
import { nextUpdates } from './release-apk.mjs'

const base = {
  pos: { versionCode: 10002, versionName: '1.0.2', url: 'https://x.com/pos.apk', notes: 'init' },
  wall: { versionCode: 1, versionName: '0.0.1', url: 'https://x.com/wall.apk', notes: 'init' },
}

test('refuses equal versionCode', () => {
  assert.throws(
    () => nextUpdates(base, 'pos', { versionCode: 10002, versionName: '1.0.2', url: 'https://x.com/pos2.apk', notes: 'n' }),
    /versionCode 10002 is not newer than 10002 in updates\.json/,
  )
})

test('refuses http url', () => {
  assert.throws(
    () => nextUpdates(base, 'pos', { versionCode: 10003, versionName: '1.0.3', url: 'http://x.com/pos.apk', notes: 'n' }),
    /https/,
  )
})

test('writes entry for wall leaving pos untouched', () => {
  const next = nextUpdates(base, 'wall', { versionCode: 2, versionName: '0.0.2', url: 'https://x.com/wall2.apk', notes: 'Better' })
  assert.deepEqual(next.pos, base.pos)
  assert.deepEqual(next.wall, { versionCode: 2, versionName: '0.0.2', url: 'https://x.com/wall2.apk', notes: 'Better' })
})

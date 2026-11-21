import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { nodeFiles } from '../server/node-files.ts'
import { openNodeSqlite } from '../server/node-sqlite.ts'
import { inAppTransport } from '../src/app/inapp-transport.ts'
import { builtInMenu } from '../till/menu.ts'
import { createTill } from '../till/till.ts'

const T = Date.UTC(2026, 10, 22, 2, 0)
const tempDirs: string[] = []
afterEach(() => {
  while (tempDirs.length) fs.rmSync(tempDirs.pop()!, { recursive: true, force: true })
})

function makeTill() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kennko-inapp-'))
  tempDirs.push(dir)
  const sql = openNodeSqlite(path.join(dir, 'pos.db'))
  const till = createTill({
    sql,
    open: openNodeSqlite,
    files: nodeFiles(dir),
    fetch: (async () => new Response('{}', { status: 503 })) as typeof fetch,
    config: {
      staffPin: '1234',
      managerPin: '0000',
      shop: { name: 'Kennko Coffee', address: 'Butuan', phone: '', receiptFooter: '' },
      discounts: [],
      apiUrl: '',
      firstRun: 'pins',
    },
    baseMenu: builtInMenu(T),
    host: 'android',
    backup: () => 'ok',
    now: () => T,
  })
  return { till, sql }
}

describe('inAppTransport', () => {
  it('session token is kept in memory', async () => {
    const { till, sql } = makeTill()
    const transport = inAppTransport(till)
    const login = await transport.call('POST', '/api/session', { pin: '1234' })
    expect(login.status).toBe(200)
    const menu = await transport.call('GET', '/api/menu')
    expect(menu.status).toBe(200)
    sql.close()
  })

  it('lock clears the token', async () => {
    const { till, sql } = makeTill()
    const transport = inAppTransport(till)
    await transport.call('POST', '/api/session', { pin: '1234' })
    await transport.call('POST', '/api/session/end', {})
    const menu = await transport.call('GET', '/api/menu')
    expect(menu.status).toBe(401)
    sql.close()
  })

  it('follow delivers frames', async () => {
    const { till, sql } = makeTill()
    const transport = inAppTransport(till)
    await transport.call('POST', '/api/session', { pin: '1234' })
    const frames: string[] = []
    const stop = transport.follow((json) => frames.push(json), () => {})
    expect(frames).toHaveLength(1)
    expect(JSON.parse(frames[0]!)).toHaveProperty('menuKey')
    stop()
    sql.close()
  })
})

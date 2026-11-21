import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { openNodeSqlite } from '../server/node-sqlite.ts'
import { runSqlContract } from '../till/sql-contract.ts'

describe('SQL contract (node:sqlite)', () => {
  it('passes all contract checks', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kennko-sql-contract-'))
    try {
      const file = path.join(dir, 'contract.db')
      expect(runSqlContract(openNodeSqlite, file)).toEqual([])
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

import { DatabaseSync } from 'node:sqlite'
import type { SqlDb, SqlOpen } from '../till/sql.ts'

export const openNodeSqlite: SqlOpen = (file: string): SqlDb => new DatabaseSync(file) as unknown as SqlDb

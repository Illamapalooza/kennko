import type { SqlDb, SqlOpen, SqlRow, SqlRunResult, SqlStatement, SqlValue } from '../../till/sql.ts'

declare global {
  interface Window {
    KennkoSqlite?: {
      call(json: string): string
      backupPath(day: string): string
      selftestPath(): string
    }
  }
}

function bridgeCall(req: Record<string, unknown>): any {
  const api = window.KennkoSqlite
  if (!api) throw new Error('KennkoSqlite bridge is not available')
  const res = JSON.parse(api.call(JSON.stringify(req)))
  if (res && typeof res.error === 'string') throw new Error(res.error)
  return res
}

export const openBridgeSqlite: SqlOpen = (file: string): SqlDb => {
  const { db } = bridgeCall({ op: 'open', file }) as { db: number }
  return {
    exec(sql: string): void {
      bridgeCall({ op: 'exec', db, sql })
    },
    prepare(sql: string): SqlStatement {
      return {
        run(...p: SqlValue[]): SqlRunResult {
          return bridgeCall({ op: 'run', db, sql, params: p }) as SqlRunResult
        },
        get(...p: SqlValue[]): SqlRow | undefined {
          const { row } = bridgeCall({ op: 'get', db, sql, params: p }) as { row: SqlRow | null }
          return row === null ? undefined : row
        },
        all(...p: SqlValue[]): SqlRow[] {
          const { rows } = bridgeCall({ op: 'all', db, sql, params: p }) as { rows: SqlRow[] }
          return rows
        },
      }
    },
    close(): void {
      bridgeCall({ op: 'close', db })
    },
  }
}

export function bridgeBackupPath(day: string): string {
  const api = window.KennkoSqlite
  if (!api) throw new Error('KennkoSqlite bridge is not available')
  return api.backupPath(day)
}

export function bridgeSelftestPath(): string {
  const api = window.KennkoSqlite
  if (!api) throw new Error('KennkoSqlite bridge is not available')
  return api.selftestPath()
}

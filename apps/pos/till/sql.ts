export type SqlValue = number | string | null
export type SqlRow = Record<string, SqlValue>
export type SqlRunResult = { changes: number | bigint; lastInsertRowid: number | bigint }
export type SqlStatement = {
  run(...p: SqlValue[]): SqlRunResult
  get(...p: SqlValue[]): SqlRow | undefined
  all(...p: SqlValue[]): SqlRow[]
}
export type SqlDb = {
  exec(sql: string): void
  prepare(sql: string): SqlStatement
  close(): void
}
export type SqlOpen = (file: string) => SqlDb

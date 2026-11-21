import type { Discount, Menu } from '@kennko/core'
import type { TillFiles } from './files.ts'
import type { SqlDb, SqlOpen } from './sql.ts'

export type TillConfig = {
  staffPin: string
  managerPin: string
  shop: { name: string; address: string; phone: string; receiptFooter: string }
  discounts: Discount[]
  apiUrl: string
  /** 'connect': the app. Nothing works until paired; pairing needs no PIN the first time; per-person PINs only. */
  firstRun: 'pins' | 'connect'
}

export type TillHost = {
  sql: SqlDb
  open: SqlOpen
  files: TillFiles
  fetch: typeof fetch
  config: TillConfig
  baseMenu: Menu
  host: 'node' | 'android'
  /** Copies the database somewhere safe; never throws; returns a line for logs. Called hourly, on start and on closing the till. */
  backup: (snapshot: (file: string) => void) => string
  now?: () => number
  timers?: { set: typeof setTimeout; clear: typeof clearTimeout }
  log?: (line: string) => void
}

export type TillRequest = {
  method: 'GET' | 'POST'
  path: string
  body?: unknown
  session?: string
  client: string
  secureUrl?: string | null
}

export type TillResponse = {
  status: number
  body: unknown
  session?: string | null
  csv?: { filename: string; text: string }
}

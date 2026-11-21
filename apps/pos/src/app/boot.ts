import { CapacitorHttp } from '@capacitor/core'
import { manilaDay } from '@kennko/core'
import { builtInMenu } from '../../till/menu.ts'
import { createStore } from '../../till/store.ts'
import { createTill } from '../../till/till.ts'
import { setTransport } from '../transport.ts'
import { appFiles } from './app-files.ts'
import { inAppTransport } from './inapp-transport.ts'
import { nativeFetch } from './native-fetch.ts'
import { runSelfTest } from './selftest.ts'
import { bridgeBackupPath, openBridgeSqlite } from './sqlite-bridge.ts'

export async function bootApp(): Promise<void> {
  if (import.meta.env.VITE_SELFTEST === '1') {
    runSelfTest()
  }

  const now = Date.now()
  const sql = openBridgeSqlite('databases/pos.db')
  const store = createStore(sql, openBridgeSqlite)
  const files = appFiles(store)

  const till = createTill({
    sql,
    open: openBridgeSqlite,
    files,
    fetch: nativeFetch(CapacitorHttp),
    config: {
      staffPin: '',
      managerPin: '',
      shop: {
        name: 'Kennko Coffee',
        address: 'CT. Montalban St., Villa Kananga, Butuan City',
        phone: '0930 599 2729',
        receiptFooter: 'Thank you! See you again soon.',
      },
      discounts: [
        { label: 'Senior / PWD 20%', kind: 'percent', value: 20 },
        { label: 'Promo 10%', kind: 'percent', value: 10 },
      ],
      apiUrl: import.meta.env.VITE_KENNKO_API_URL ?? '',
      firstRun: 'connect',
    },
    baseMenu: builtInMenu(now),
    host: 'android',
    backup: (snapshot) => {
      try {
        snapshot(bridgeBackupPath(manilaDay(Date.now())))
        return 'saved'
      } catch (err: any) {
        console.error(`Backup failed: ${err?.message ?? err}`)
        return `FAILED (${err?.message ?? err})`
      }
    },
    log: console.log,
  })

  till.start()
  setTransport(inAppTransport(till))
}

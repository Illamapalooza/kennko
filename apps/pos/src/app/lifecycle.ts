import { manilaDay } from '@kennko/core'
import type { Till } from '../../till/till.ts'
import { bridgeBackupPath } from './sqlite-bridge.ts'

export function wireLifecycle(
  till: Pick<Till, 'pause' | 'resume'>,
  app: { addListener(e: 'pause' | 'resume', fn: () => void): unknown },
): void {
  app.addListener('pause', () => till.pause())
  app.addListener('resume', () => till.resume())
}

export function appBackup(
  snapshot: (file: string) => void,
  now: number,
  backupPath: (day: string) => string = bridgeBackupPath,
): string {
  try {
    const file = backupPath(manilaDay(now))
    snapshot(file)
    return `saved ${file}`
  } catch (err: any) {
    return `FAILED (${err?.message ?? err})`
  }
}

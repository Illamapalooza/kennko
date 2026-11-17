import fs from 'node:fs'
import path from 'node:path'

export const BACKUPS_KEPT = 30
const NAME = /^pos-\d{4}-\d{2}-\d{2}\.db$/

export type BackupResult = { file: string; copy: string | null; copyError: string | null }

/**
 * Writes one backup per day, replacing the same day's earlier one, and keeps the newest 30.
 * `snapshot` must write a complete copy of the database to the path it is given.
 * `copyDir`, when set, receives a second copy (a USB stick or a cloud-synced folder); a failure
 * there is reported but never stops the local backup.
 */
export function backupDay(snapshot: (file: string) => void, dir: string, day: string, copyDir = '', keep = BACKUPS_KEPT): BackupResult {
  fs.mkdirSync(dir, { recursive: true })
  const name = `pos-${day}.db`
  const file = path.join(dir, name)
  const temp = `${file}.part`
  fs.rmSync(temp, { force: true })
  snapshot(temp)
  fs.renameSync(temp, file)
  prune(dir, keep)

  let copy: string | null = null
  let copyError: string | null = null
  if (copyDir) {
    try {
      fs.mkdirSync(copyDir, { recursive: true })
      copy = path.join(copyDir, name)
      fs.copyFileSync(file, copy)
      prune(copyDir, keep)
    } catch (err: any) {
      copy = null
      copyError = err.message
    }
  }
  return { file, copy, copyError }
}

function prune(dir: string, keep: number) {
  const old = fs.readdirSync(dir).filter((f) => NAME.test(f)).sort().reverse().slice(keep)
  for (const f of old) fs.rmSync(path.join(dir, f), { force: true })
}

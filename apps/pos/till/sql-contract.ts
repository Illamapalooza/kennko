import type { SqlDb, SqlOpen } from './sql.ts'

export function runSqlContract(open: SqlOpen, file: string): string[] {
  const failures: string[] = []
  let db: SqlDb | null = null
  let copy: SqlDb | null = null
  const check = (name: string, cond: boolean, detail?: string) => {
    if (!cond) failures.push(detail ? `${name}: ${detail}` : name)
  }

  try {
    db = open(file)

    const wal = db.prepare('pragma journal_mode = wal').get()
    check('wal mode', String(wal?.journal_mode ?? '').toLowerCase() === 'wal', `got ${JSON.stringify(wal)}`)

    db.exec(`
      create table items (
        id integer primary key autoincrement,
        ts integer not null,
        note text,
        code text unique
      );
      create table log (k text primary key, v text);
    `)

    const ts = 1732233600123
    const text = 'Ñoño ☕🐈'
    const r1 = db.prepare('insert into items (ts, note, code) values (?, ?, ?)').run(ts, null, 'A1')
    check('first rowid is 1', Number(r1.lastInsertRowid) === 1, `got ${r1.lastInsertRowid}`)
    check('first insert changes is 1', Number(r1.changes) === 1, `got ${r1.changes}`)

    const r2 = db.prepare('insert into items (ts, note, code) values (?, ?, ?)').run(ts + 1, text, 'A2')
    check('second rowid is 2', Number(r2.lastInsertRowid) === 2, `got ${r2.lastInsertRowid}`)

    const row1 = db.prepare('select ts, note from items where id = ?').get(1)
    check('timestamp > 2^31 round-trips as number', row1?.ts === ts && typeof row1.ts === 'number', `got ${JSON.stringify(row1?.ts)}`)
    check('null round-trips', row1?.note === null, `got ${JSON.stringify(row1?.note)}`)

    const row2 = db.prepare('select note from items where id = ?').get(2)
    check('unicode & emoji round-trip', row2?.note === text, `got ${JSON.stringify(row2?.note)}`)

    const missing = db.prepare('select id from items where id = ?').get(999)
    check('get with no row returns undefined', missing === undefined, `got ${JSON.stringify(missing)}`)

    const u0 = db.prepare('update items set note = ? where id = ?').run('x', 999)
    check('changes is 0 on unmatched update', Number(u0.changes) === 0, `got ${u0.changes}`)

    const all = db.prepare('select id from items order by id asc').all()
    check('all keeps order', all.length === 2 && all[0]?.id === 1 && all[1]?.id === 2, `got ${JSON.stringify(all)}`)

    db.exec('begin immediate')
    db.prepare('insert into log (k, v) values (?, ?)').run('temp', '1')
    db.exec('rollback')
    const rolledBack = db.prepare('select v from log where k = ?').get('temp')
    check('rollback leaves no row', rolledBack === undefined, `got ${JSON.stringify(rolledBack)}`)

    let uniqueMsg = ''
    try {
      db.prepare('insert into items (ts, note, code) values (?, ?, ?)').run(ts, null, 'A1')
    } catch (err: any) {
      uniqueMsg = String(err?.message ?? err)
    }
    check('unique error keeps message', uniqueMsg.includes('UNIQUE constraint failed'), `got ${uniqueMsg}`)

    const copyFile = `${file}.copy`
    db.prepare('vacuum into ?').run(copyFile)
    copy = open(copyFile)
    const copyRow = copy.prepare('select note from items where id = ?').get(2)
    check('vacuum into creates readable copy', copyRow?.note === text, `got ${JSON.stringify(copyRow)}`)
  } catch (err: any) {
    failures.push(`unexpected error: ${err?.message ?? String(err)}`)
  } finally {
    try { copy?.close() } catch {}
    try { db?.close() } catch {}
  }

  return failures
}

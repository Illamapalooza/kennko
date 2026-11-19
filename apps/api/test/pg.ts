import { readdirSync, readFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import postgres from 'postgres'

const here = fileURLToPath(new URL('.', import.meta.url))
const migrationsDir = join(here, '..', 'supabase', 'migrations')

export type TestDb = {
  sql: postgres.Sql
  url: string
  stop(): Promise<void>
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.once('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as { port: number }
      srv.close(() => resolve(port))
    })
  })
}

export type StartOptions = {
  /** Apply migrations in name order, but run `sql` just before the first file whose name starts with `migration`. */
  seedBefore?: { migration: string; sql: string }
}

/** Fresh in-memory Postgres with Supabase stubs and every migration applied. */
export async function startTestDb(opts: StartOptions = {}): Promise<TestDb> {
  const pg = new PGlite()
  let server: PGLiteSocketServer | undefined
  let sql: postgres.Sql | undefined
  try {
    await pg.waitReady
    await pg.exec(readFileSync(join(here, 'supabase-stubs.sql'), 'utf8'))
    for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
      if (opts.seedBefore && file.startsWith(opts.seedBefore.migration)) {
        await pg.exec(opts.seedBefore.sql)
      }
      try {
        await pg.exec(readFileSync(join(migrationsDir, file), 'utf8'))
      } catch (err) {
        throw new Error(`migration ${file} failed: ${(err as Error).message}`)
      }
    }

    const port = await freePort()
    server = new PGLiteSocketServer({ db: pg, port, host: '127.0.0.1' })
    await server.start()

    const url = `postgres://postgres:postgres@127.0.0.1:${port}/postgres`
    // PGlite serves one connection at a time and has no prepared-statement pool.
    sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} })
    const client = sql
    const srv = server

    return {
      sql: client,
      url,
      async stop() {
        try {
          await client.end({ timeout: 1 })
        } finally {
          try {
            await srv.stop()
          } finally {
            await pg.close()
          }
        }
      },
    }
  } catch (err) {
    try {
      await sql?.end({ timeout: 1 })
    } catch {}
    try {
      await server?.stop()
    } catch {}
    try {
      await pg.close()
    } catch {}
    throw err
  }
}

/** Run `fn` in a transaction as an RLS role: `authenticated` with a user id, or `anon`. */
export async function asUser<T>(
  sql: postgres.Sql,
  userId: string | null,
  fn: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  return (await sql.begin(async (tx) => {
    await tx.unsafe(`set local role ${userId === null ? 'anon' : 'authenticated'}`)
    await tx`select set_config('request.jwt.claim.sub', ${userId ?? ''}, true)`
    await tx`select set_config('request.jwt.claim.role', ${userId === null ? 'anon' : 'authenticated'}, true)`
    return fn(tx)
  })) as T
}

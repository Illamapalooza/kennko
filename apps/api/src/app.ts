import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type postgres from 'postgres'
import type { AppEnv } from './auth.ts'
import { apiError } from './http.ts'

export type AppDeps = {
  sql: postgres.Sql
  verifyUser: (token: string) => Promise<{ userId: string }>
}

export function createApp(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  app.notFound(() => {
    throw apiError(404, 'NOT_FOUND', 'Not found')
  })

  app.onError((err, c) => {
    if (err instanceof HTTPException && err.res) return err.res
    console.error(err)
    return c.json({ code: 'INTERNAL', message: 'Something went wrong' }, 500)
  })

  app.get('/health', async (c) => {
    await deps.sql`select 1`
    return c.json({ ok: true })
  })

  return app
}

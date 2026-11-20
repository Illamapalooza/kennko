// Source entry, bundled by `npm run build` into server.js (the file Vercel deploys) together with
// @kennko/core, which Node cannot run from node_modules as TypeScript.
import type { Hono } from 'hono'
import type { AppEnv } from './auth.js'
import { buildApp } from './boot.js'

const app: Hono<AppEnv> = buildApp(process.env)

export default app

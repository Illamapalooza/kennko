import { serve } from '@hono/node-server'
import app from './index.ts'

const port = 4477
serve({ fetch: app.fetch, port }, () => console.log(`kennko api on http://localhost:${port}`))

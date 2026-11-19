import { createApp } from './app.ts'
import { createUserVerifier } from './auth.ts'
import { loadConfig } from './config.ts'
import { createSql } from './db.ts'

const config = loadConfig(process.env)

export default createApp({
  sql: createSql(config.databaseUrl),
  verifyUser: createUserVerifier(config.supabaseUrl),
})

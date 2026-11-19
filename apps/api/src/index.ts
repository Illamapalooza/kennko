import { createApp } from './app.ts'
import { loadConfig } from './config.ts'
import { createSql } from './db.ts'

const config = loadConfig(process.env)

export default createApp({
  sql: createSql(config.databaseUrl),
  verifyUser: async () => {
    throw new Error('verifyUser is not wired yet')
  },
})

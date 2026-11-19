import postgres from 'postgres'

export function createSql(url: string): postgres.Sql {
  return postgres(url, { prepare: false, max: 1, idle_timeout: 20 })
}

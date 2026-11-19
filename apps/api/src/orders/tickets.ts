import type postgres from 'postgres'

/**
 * The next ticket number for a Manila business day and series. An upsert ... returning, never
 * max()+1, so two checkouts at once cannot take the same number.
 */
export async function nextTicket(tx: postgres.TransactionSql, businessDay: string, series: 'W'): Promise<number> {
  const [row] = await tx<{ last_number: number }[]>`
    insert into ticket_counters (business_day, series, last_number)
    values (${businessDay}, ${series}, 1)
    on conflict (business_day, series) do update set last_number = ticket_counters.last_number + 1
    returning last_number`
  return row!.last_number
}

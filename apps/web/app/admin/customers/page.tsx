import Link from 'next/link'
import type { CustomerListItem, PaperStamp } from '@kennko/core'
import { requireManager } from '@/lib/auth/session'
import { staffFetch } from '@/lib/api/client'
import { PaperStampRow } from '@/components/admin/PaperStampRow'
import { manilaStamp } from '../reports/dates'
import { cardState } from './format'

export const dynamic = 'force-dynamic'

async function get<T>(path: string): Promise<T | null> {
  try {
    const res = await staffFetch(path)
    return res.ok ? ((await res.json()) as T) : null
  } catch {
    return null
  }
}

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireManager()
  const { q: raw } = await searchParams
  const q = (raw ?? '').trim().slice(0, 40)
  const [stamps, results] = await Promise.all([
    get<PaperStamp[]>('/v1/stamps/to-check'),
    q.length >= 2 ? get<CustomerListItem[]>(`/v1/customers?q=${encodeURIComponent(q)}`) : Promise.resolve([] as CustomerListItem[]),
  ])

  return (
    <>
      <h1>Customers</h1>

      {stamps && stamps.length > 0 ? (
        <section aria-labelledby="stamps-to-check">
          <h2 id="stamps-to-check">Stamps to check</h2>
          <p className="report-note">Rung up for someone on a paper card. Apply once they are on the digital card, or discard.</p>
          <div className="attention-list">
            {stamps.map((s) => (
              <PaperStampRow key={s.id} stamp={s} />
            ))}
          </div>
        </section>
      ) : null}
      {!stamps ? (
        <p className="admin-error" role="alert">
          Couldn&apos;t load the stamps to check. Refresh to try again.
        </p>
      ) : null}

      <form className="attention-form" action="/admin/customers" method="get">
        <label className="admin-field">
          Code or name
          <input name="q" defaultValue={q} maxLength={40} />
        </label>
        <button type="submit" className="btn btn-primary">
          Search
        </button>
      </form>

      {q.length > 0 && q.length < 2 ? <p>Type at least 2 characters.</p> : null}
      {results === null ? (
        <p className="admin-error" role="alert">
          Couldn&apos;t load this. Refresh to try again.
        </p>
      ) : q.length >= 2 && results.length === 0 ? (
        <p>No customers found.</p>
      ) : results.length > 0 ? (
        <div className="section-card report-scroll">
          <table className="report-table" aria-label="Customers">
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Card</th>
                <th className="num">Stamps</th>
                <th className="num">Full cards</th>
                <th className="num">Points</th>
                <th>Joined</th>
              </tr>
            </thead>
            <tbody>
              {results.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link href={`/admin/customers/${c.id}`}>{c.publicCode}</Link>
                  </td>
                  <td>{c.displayName}</td>
                  <td>{c.stampMode === 'paper' ? <span className="report-pill">Paper</span> : cardState(c.stampMode)}</td>
                  <td className="num">{c.stamps}</td>
                  <td className="num">{c.fullCards}</td>
                  <td className={c.points < 0 ? 'num points-negative' : 'num'}>{c.points}</td>
                  <td>{manilaStamp(c.joinedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </>
  )
}

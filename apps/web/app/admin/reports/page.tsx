import Link from 'next/link'
import type { DayReport as DayReportData } from '@kennko/core'
import { requireManager } from '@/lib/auth/session'
import { staffFetch } from '@/lib/api/client'
import { DayReport } from '@/components/admin/DayReport'
import { dayNav, manilaToday, parseDay } from './dates'

export const dynamic = 'force-dynamic'

const LOAD_ERROR = "Couldn't load the report. Refresh to try again."

async function loadReport(date: string): Promise<DayReportData | null> {
  try {
    const res = await staffFetch(`/v1/reports/day/${date}`)
    return res.ok ? ((await res.json()) as DayReportData) : null
  } catch {
    return null
  }
}

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  await requireManager()
  const { date: q } = await searchParams
  const today = manilaToday(Date.now())
  const date = parseDay(q, today)
  const nav = dayNav(date, today)
  const report = await loadReport(date)

  return (
    <>
      <h1>Reports</h1>
      <nav className="report-nav" aria-label="Report day">
        <Link className="btn btn-secondary" href={`/admin/reports?date=${nav.prev}`}>
          Previous day
        </Link>
        <strong aria-live="polite">{nav.label}</strong>
        {date !== today ? (
          <Link className="btn btn-secondary" href="/admin/reports">
            Today
          </Link>
        ) : null}
        {nav.next ? (
          <Link className="btn btn-secondary" href={`/admin/reports?date=${nav.next}`}>
            Next day
          </Link>
        ) : null}
      </nav>
      {report ? (
        <DayReport report={report} />
      ) : (
        <p className="admin-error" role="alert">
          {LOAD_ERROR}
        </p>
      )}
    </>
  )
}

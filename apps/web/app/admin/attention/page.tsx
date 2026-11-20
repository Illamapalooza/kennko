import Link from 'next/link'
import { formatPesos, type AttentionView } from '@kennko/core'
import { requireOwner } from '@/lib/auth/session'
import { staffFetch } from '@/lib/api/client'
import { AttentionRow, FlaggedOrderRow, RetryTillButton } from '@/components/admin/AttentionRow'
import { CloseShiftForm } from '@/components/admin/CloseShiftForm'
import { manilaStamp } from '../reports/dates'
import { canCloseShift } from './text'

export const dynamic = 'force-dynamic'

async function load(show: 'open' | 'resolved'): Promise<AttentionView | null> {
  try {
    const res = await staffFetch(`/v1/attention?show=${show}`)
    return res.ok ? ((await res.json()) as AttentionView) : null
  } catch {
    return null
  }
}

/** The till names with held rows, and how many each holds, for the one retry button per till. */
function heldByTill(view: AttentionView): { deviceId: string; deviceName: string; held: number }[] {
  const tills = new Map<string, { deviceId: string; deviceName: string; held: number }>()
  for (const e of view.events) {
    if (e.result !== 'held') continue
    const t = tills.get(e.deviceId) ?? { deviceId: e.deviceId, deviceName: e.deviceName, held: 0 }
    t.held += 1
    tills.set(e.deviceId, t)
  }
  return [...tills.values()]
}

export default async function AttentionPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  await requireOwner()
  const { show: q } = await searchParams
  const show = q === 'resolved' ? 'resolved' : 'open'
  const view = await load(show)

  return (
    <>
      <h1>Needs a look</h1>
      <nav className="order-tabs" aria-label="Needs a look">
        <Link className="order-tab" href="/admin/attention" aria-current={show === 'open' ? 'page' : undefined}>
          Open
        </Link>
        <Link className="order-tab" href="/admin/attention?show=resolved" aria-current={show === 'resolved' ? 'page' : undefined}>
          Resolved
        </Link>
      </nav>

      {!view ? (
        <p className="admin-error" role="alert">
          Couldn&apos;t load this. Refresh to try again.
        </p>
      ) : view.events.length + view.orders.length + view.shifts.length === 0 ? (
        <p>Nothing needs a look.</p>
      ) : (
        <>
          {view.shifts.length > 0 ? (
            <section aria-labelledby="open-shifts">
              <h2 id="open-shifts">Open shifts</h2>
              <div className="attention-list">
                {view.shifts.map((s) => (
                  <article key={s.id} className="section-card attention-row">
                    <p>
                      <strong>{s.deviceName}</strong>
                      {s.deviceRevoked ? ' (disconnected)' : ''}
                      {s.blocking > 0 ? (
                        <>
                          {' '}
                          <span className="report-pill">Blocking sync</span>
                        </>
                      ) : null}
                    </p>
                    <p className="report-note">
                      Opened {manilaStamp(s.openedAt)}
                      {s.openedByName ? ` by ${s.openedByName}` : ''}, float {formatPesos(s.openingFloatCentavos)}
                      {s.blocking > 0 ? `. ${s.blocking} ${s.blocking === 1 ? 'record is' : 'records are'} waiting on it.` : ''}
                    </p>
                    {canCloseShift(s) ? <CloseShiftForm shiftId={s.id} tillName={s.deviceName} /> : null}
                  </article>
                ))}
              </div>
            </section>
          ) : null}

          {view.events.length > 0 ? (
            <section aria-labelledby="till-records">
              <h2 id="till-records">Till records</h2>
              {show === 'open' ? (
                <div className="attention-list">
                  {heldByTill(view).map((t) => (
                    <RetryTillButton key={t.deviceId} deviceId={t.deviceId} tillName={t.deviceName} held={t.held} />
                  ))}
                </div>
              ) : null}
              <div className="attention-list">
                {view.events.map((e) => (
                  <AttentionRow key={`${e.deviceId}|${e.id}`} event={e} />
                ))}
              </div>
            </section>
          ) : null}

          {view.orders.length > 0 ? (
            <section aria-labelledby="flagged-orders">
              <h2 id="flagged-orders">Flagged orders</h2>
              <div className="attention-list">
                {view.orders.map((o) => (
                  <FlaggedOrderRow key={o.id} order={o} />
                ))}
              </div>
            </section>
          ) : null}
        </>
      )}
    </>
  )
}

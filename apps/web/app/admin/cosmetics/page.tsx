import { COSMETIC_SLOTS, type CosmeticView } from '@kennko/core'
import { requireOwner } from '@/lib/auth/session'
import { staffFetch } from '@/lib/api/client'
import { SLOT_LABELS } from '@/app/account/cat'
import { CosmeticRow } from '@/components/admin/CosmeticRow'

export const dynamic = 'force-dynamic'

async function load(): Promise<CosmeticView[] | null> {
  try {
    const res = await staffFetch('/v1/cosmetics/all')
    return res.ok ? ((await res.json()) as CosmeticView[]) : null
  } catch {
    return null
  }
}

export default async function CosmeticsPage() {
  await requireOwner()
  const items = await load()

  return (
    <>
      <h1>Cosmetics</h1>
      <p className="report-note">
        Rename, reprice (in points), switch off or reorder what customers can buy for their cat. New items need new art in code,
        so they cannot be added here. A switched-off item stays with the people who own it.
      </p>
      {items === null ? (
        <p className="admin-error" role="alert">Couldn&apos;t load the catalogue. Refresh to try again.</p>
      ) : (
        COSMETIC_SLOTS.map((slot) => {
          const rows = items.filter((i) => i.slot === slot).sort((a, b) => a.sortOrder - b.sortOrder)
          return rows.length === 0 ? null : (
            <section key={slot} aria-labelledby={`slot-${slot}`}>
              <h2 id={`slot-${slot}`}>{SLOT_LABELS[slot]}</h2>
              <div className="attention-list">
                {rows.map((item) => (
                  <CosmeticRow key={item.id} item={item} />
                ))}
              </div>
            </section>
          )
        })
      )}
    </>
  )
}

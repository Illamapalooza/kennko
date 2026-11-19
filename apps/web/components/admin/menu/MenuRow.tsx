'use client'

import Link from 'next/link'
import { AvailabilityToggle } from '@/components/admin/AvailabilityToggle'
import { rowCells } from '@/app/admin/menu/table'
import type { AdminTableItem } from '@/lib/menu/types'
import { PriceCell } from './PriceCell'
import { StarToggle } from './StarToggle'

export function MenuRow({ item, kind, isOwner }: { item: AdminTableItem; kind: 'drink' | 'food'; isOwner: boolean }) {
  const cells = rowCells(item, kind)
  return (
    <div className={`menu-row${item.isArchived ? ' is-archived' : ''}`}>
      <div className="menu-row-name">
        <StarToggle itemId={item.id} isBestseller={item.isBestseller} editable={isOwner} />
        <Link href={`/admin/menu?edit=${item.id}`}>{item.name}</Link>
        {item.isArchived ? <span className="menu-row-tag">Archived</span> : null}
        {!item.isAvailable ? <span className="price-cell-sold">Sold out</span> : null}
      </div>
      <div className="menu-row-prices">
        {cells.map((cell) => (
          <PriceCell
            key={cell.code}
            itemId={item.id}
            itemName={item.name}
            code={cell.code}
            label={cell.label}
            initialCentavos={cell.priceCentavos}
            editable={isOwner}
            soldOut={cell.priceCentavos !== null && !cell.isAvailable}
          />
        ))}
      </div>
      <div className="menu-row-actions">
        <AvailabilityToggle itemId={item.id} isAvailable={item.isAvailable} />
        <Link className="menu-row-open" href={`/admin/menu?edit=${item.id}`} aria-label={`Open ${item.name}`}>
          ›
        </Link>
      </div>
    </div>
  )
}

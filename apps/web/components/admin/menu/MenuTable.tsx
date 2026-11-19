'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { filterMenu } from '@/app/admin/menu/table'
import type { AdminMenu } from '@/lib/menu/types'
import { MenuRow } from './MenuRow'

export function MenuTable({ menu, isOwner, initialSoldOut = false }: { menu: AdminMenu; isOwner: boolean; initialSoldOut?: boolean }) {
  const [query, setQuery] = useState('')
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const [soldOutOnly, setSoldOutOnly] = useState(initialSoldOut)

  const shown = useMemo(
    () => filterMenu(menu, { query, categoryId, showArchived, soldOutOnly }),
    [menu, query, categoryId, showArchived, soldOutOnly],
  )

  return (
    <div className="menu-table">
      <div className="menu-toolbar">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search items"
          aria-label="Search items"
        />
        {isOwner ? (
          <Link className="btn btn-primary" href="/admin/menu?new=1">
            + Add
          </Link>
        ) : null}
      </div>

      <div className="menu-chips" role="group" aria-label="Category">
        <button type="button" className="menu-chip" aria-pressed={categoryId === null} onClick={() => setCategoryId(null)}>
          All
        </button>
        {menu.categories.map((c) => (
          <button
            key={c.id}
            type="button"
            className="menu-chip"
            aria-pressed={categoryId === c.id}
            onClick={() => setCategoryId(c.id)}
          >
            {c.name}
          </button>
        ))}
      </div>

      <div className="menu-toggles">
        <label>
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived
        </label>
        <label>
          <input type="checkbox" checked={soldOutOnly} onChange={(e) => setSoldOutOnly(e.target.checked)} /> Sold out only
        </label>
      </div>

      {shown.categories.length === 0 ? (
        <p className="menu-empty">{query.trim() ? `No items match "${query.trim()}"` : 'No items to show'}</p>
      ) : (
        shown.categories.map((category) => (
          <section key={category.id} className="menu-category">
            <h2 className="menu-category-head">{category.name}</h2>
            {category.items.map((item) => (
              <MenuRow key={item.id} item={item} kind={category.kind} isOwner={isOwner} />
            ))}
          </section>
        ))
      )}
    </div>
  )
}

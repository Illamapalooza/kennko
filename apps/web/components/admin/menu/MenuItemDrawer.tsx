'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { archiveMenuItem, saveMenuItemDraft, setItemOptionGroups } from '@/app/admin/menu/actions'
import { CategoryPriceFields } from '../CategoryPriceFields'
import { ImageUploadField } from '../ImageUploadField'
import type { CategoryKind } from '@/app/admin/menu/format'
import type { AdminTableItem } from '@/lib/menu/types'

type DrawerItem = AdminTableItem & { imageUrl: string | null }

type MenuItemDrawerProps = {
  item: DrawerItem | null
  categories: { id: string; name: string; kind: CategoryKind }[]
  optionGroups: { id: string; name: string }[]
  isOwner: boolean
}

const CLOSE_TO = '/admin/menu'
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])'

export function MenuItemDrawer({ item, categories, optionGroups, isOwner }: MenuItemDrawerProps) {
  const router = useRouter()
  const panelRef = useRef<HTMLDivElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [checked, setChecked] = useState<string[]>(item?.optionGroupIds ?? [])

  const close = () => router.replace(CLOSE_TO)

  // Focus moves in on open and returns to whatever opened the drawer on close.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    ;(nameRef.current ?? panelRef.current?.querySelector<HTMLElement>(FOCUSABLE))?.focus()
    return () => opener?.focus?.()
  }, [])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        router.replace(CLOSE_TO)
        return
      }
      if (event.key !== 'Tab' || !panelRef.current) return
      const nodes = panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)
      if (nodes.length === 0) return
      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [router])

  if (!isOwner) return null

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    setError(null)
    startTransition(async () => {
      const saved = await saveMenuItemDraft(formData)
      if (!saved.ok) return setError(saved.message)
      if (item) {
        const groups = await setItemOptionGroups(
          saved.id,
          optionGroups.filter((g) => checked.includes(g.id)).map((g) => g.id),
        )
        if (!groups.ok) return setError(groups.message)
      }
      router.replace(CLOSE_TO)
    })
  }

  function onArchive() {
    if (!item) return
    setError(null)
    startTransition(async () => {
      try {
        await archiveMenuItem(item.id)
        router.replace(CLOSE_TO)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Could not archive the item')
      }
    })
  }

  const title = item ? `Edit ${item.name}` : 'New item'

  return (
    <div className="menu-drawer-backdrop" onClick={close}>
      <div
        ref={panelRef}
        className="menu-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="menu-drawer-head">
          <h2>{title}</h2>
          <button type="button" className="menu-drawer-close" aria-label="Close" onClick={close}>
            ✕
          </button>
        </header>

        <form onSubmit={onSubmit}>
          {item ? <input type="hidden" name="id" value={item.id} /> : null}

          <label className="admin-field">
            <span>Name</span>
            <input ref={nameRef} name="name" defaultValue={item?.name ?? ''} required />
          </label>

          {item ? (
            <>
              <input type="hidden" name="category_id" value={item.categoryId} />
              <label className="admin-field">
                <span>Category</span>
                <select value={item.categoryId} disabled>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : null}

          <label className="admin-field">
            <span>Description (optional)</span>
            <textarea name="description" defaultValue={item?.description ?? ''} />
          </label>

          {item ? null : <CategoryPriceFields categories={categories} categoryId="" prices={[]} />}

          <label className="admin-field menu-drawer-check">
            <span>
              <input type="checkbox" name="is_bestseller" defaultChecked={item?.isBestseller ?? false} />
              Bestseller (shows a star)
            </span>
          </label>

          {item ? (
            <fieldset className="menu-drawer-groups">
              <legend>Add-on groups</legend>
              {optionGroups.map((group) => (
                <label key={group.id} className="menu-drawer-check">
                  <input
                    type="checkbox"
                    checked={checked.includes(group.id)}
                    onChange={(e) =>
                      setChecked((prev) =>
                        e.target.checked ? [...prev, group.id] : prev.filter((id) => id !== group.id),
                      )
                    }
                  />
                  {group.name}
                </label>
              ))}
            </fieldset>
          ) : (
            <p className="admin-notice">Save the item first, then reopen it to add a photo and pick add-ons.</p>
          )}

          {error ? (
            <p className="admin-error" role="alert">
              {error}
            </p>
          ) : null}

          <div className="menu-drawer-actions">
            <button className="btn btn-primary" type="submit" disabled={pending}>
              Save
            </button>
            {item ? (
              <button className="btn btn-secondary" type="button" disabled={pending} onClick={onArchive}>
                Archive
              </button>
            ) : null}
          </div>
        </form>

        {item ? <ImageUploadField itemId={item.id} currentUrl={item.imageUrl} /> : null}
      </div>
    </div>
  )
}

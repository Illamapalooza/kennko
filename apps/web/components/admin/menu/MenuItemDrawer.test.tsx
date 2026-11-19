import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const replace = vi.fn()
const saveMenuItemDraft = vi.fn()
const setItemOptionGroups = vi.fn()
const archiveMenuItem = vi.fn()
const unarchiveMenuItem = vi.fn()

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace }) }))
vi.mock('@/app/admin/menu/actions', () => ({
  saveMenuItemDraft: (...a: unknown[]) => saveMenuItemDraft(...a),
  setItemOptionGroups: (...a: unknown[]) => setItemOptionGroups(...a),
  archiveMenuItem: (...a: unknown[]) => archiveMenuItem(...a),
  unarchiveMenuItem: (...a: unknown[]) => unarchiveMenuItem(...a),
  uploadMenuImage: vi.fn(),
  removeMenuImage: vi.fn(),
}))

import { MenuItemDrawer } from './MenuItemDrawer'

const categories = [
  { id: 'c1', name: 'Coffee', kind: 'drink' as const },
  { id: 'c2', name: 'Pastry', kind: 'food' as const },
]
const optionGroups = [
  { id: 'g1', name: 'Milk', minSelect: 0, maxSelect: 1 },
  { id: 'g2', name: 'Extras', minSelect: 0, maxSelect: 3 },
]
const item = {
  id: 'i1', name: 'Latte', description: 'Smooth', imagePath: null, imageUrl: null, isBestseller: true,
  isAvailable: true, isArchived: false, categoryId: 'c1', prices: [], optionGroupIds: ['g2'],
}

describe('MenuItemDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    saveMenuItemDraft.mockResolvedValue({ ok: true, id: 'i1' })
    setItemOptionGroups.mockResolvedValue({ ok: true })
  })

  it('shows the item fields and checked option groups', () => {
    render(<MenuItemDrawer item={item} categories={categories} optionGroups={optionGroups} isOwner />)
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Latte')
    expect((screen.getByLabelText('Description (optional)') as HTMLTextAreaElement).value).toBe('Smooth')
    expect((screen.getByLabelText('Extras') as HTMLInputElement).checked).toBe(true)
    expect((screen.getByLabelText('Milk') as HTMLInputElement).checked).toBe(false)
  })

  it('saves the draft then the checked option groups, then closes', async () => {
    render(<MenuItemDrawer item={item} categories={categories} optionGroups={optionGroups} isOwner />)
    fireEvent.click(screen.getByLabelText('Milk'))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/admin/menu'))
    expect(saveMenuItemDraft).toHaveBeenCalledTimes(1)
    expect(setItemOptionGroups).toHaveBeenCalledWith('i1', ['g1', 'g2'])
  })

  it('renders a save error inside the drawer and stays open', async () => {
    saveMenuItemDraft.mockResolvedValue({ ok: false, message: 'Enter a name' })
    render(<MenuItemDrawer item={item} categories={categories} optionGroups={optionGroups} isOwner />)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Enter a name')
    expect(screen.getByRole('dialog').contains(alert)).toBe(true)
    expect(setItemOptionGroups).not.toHaveBeenCalled()
    expect(replace).not.toHaveBeenCalled()
  })

  it('closes on Escape and on the close button', () => {
    render(<MenuItemDrawer item={item} categories={categories} optionGroups={optionGroups} isOwner />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(replace).toHaveBeenCalledWith('/admin/menu')
    replace.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(replace).toHaveBeenCalledWith('/admin/menu')
  })

  it('moves focus into the drawer and back on close', () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    const { unmount } = render(<MenuItemDrawer item={item} categories={categories} optionGroups={optionGroups} isOwner />)
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true)
    unmount()
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })

  it('shows price fields for a new item', () => {
    render(<MenuItemDrawer item={null} categories={categories} optionGroups={optionGroups} isOwner />)
    expect(screen.getByLabelText('Name')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy()
  })

  it('gives a barista no edit controls', () => {
    render(<MenuItemDrawer item={item} categories={categories} optionGroups={optionGroups} isOwner={false} />)
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Archive' })).toBeNull()
    expect(screen.queryByLabelText('Name')).toBeNull()
  })

  it('asks before archiving, and does nothing when cancelled', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<MenuItemDrawer item={item} categories={categories} optionGroups={optionGroups} isOwner />)
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }))
    expect(confirm).toHaveBeenCalledWith('Archive "Latte"? It disappears from the menu after you publish.')
    expect(archiveMenuItem).not.toHaveBeenCalled()
    confirm.mockRestore()
  })

  it('archives after confirmation', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    archiveMenuItem.mockResolvedValue(undefined)
    render(<MenuItemDrawer item={item} categories={categories} optionGroups={optionGroups} isOwner />)
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }))
    await waitFor(() => expect(archiveMenuItem).toHaveBeenCalledWith('i1'))
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/admin/menu'))
    confirm.mockRestore()
  })

  it('shows Restore instead of Archive for an archived item', async () => {
    unarchiveMenuItem.mockResolvedValue({ ok: true })
    render(
      <MenuItemDrawer item={{ ...item, isArchived: true }} categories={categories} optionGroups={optionGroups} isOwner />,
    )
    expect(screen.queryByRole('button', { name: 'Archive' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }))
    await waitFor(() => expect(unarchiveMenuItem).toHaveBeenCalledWith('i1'))
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/admin/menu'))
  })

  it('shows a restore error inline', async () => {
    unarchiveMenuItem.mockResolvedValue({ ok: false, message: 'Only the owner can change the menu.' })
    render(
      <MenuItemDrawer item={{ ...item, isArchived: true }} categories={categories} optionGroups={optionGroups} isOwner />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Only the owner can change the menu.')
    expect(replace).not.toHaveBeenCalled()
  })
})

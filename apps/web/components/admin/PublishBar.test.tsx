import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@/app/admin/menu/actions', () => ({ publishMenuNow: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

import { PublishBar } from './PublishBar'

describe('PublishBar', () => {
  it('says when the status is unavailable', () => {
    render(<PublishBar status={{ ok: false }} isOwner />)
    expect(screen.getByText('Menu status unavailable')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull()
  })

  it('shows unpublished changes and the Publish button for an owner', () => {
    render(
      <PublishBar
        status={{ ok: true, publishedVersion: 3, publishedAt: null, hasUnpublishedChanges: true }}
        isOwner
      />,
    )
    expect(screen.getByText('Unpublished changes')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Publish' })).toBeTruthy()
  })

  it('hides Publish from a barista', () => {
    render(
      <PublishBar
        status={{ ok: true, publishedVersion: 3, publishedAt: null, hasUnpublishedChanges: true }}
        isOwner={false}
      />,
    )
    expect(screen.getByText('Unpublished changes')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull()
  })

  it('shows the published version when nothing is pending', () => {
    render(
      <PublishBar
        status={{ ok: true, publishedVersion: 7, publishedAt: null, hasUnpublishedChanges: false }}
        isOwner
      />,
    )
    expect(screen.getByText('Menu published · version 7')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull()
  })
})

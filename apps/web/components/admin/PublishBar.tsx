import type { MenuStatus } from '@/lib/menu/status'
import { PublishMenuButton } from './PublishMenuButton'

type PublishBarProps = { status: MenuStatus; isOwner: boolean }

export function PublishBar({ status, isOwner }: PublishBarProps) {
  const pending = status.ok && status.hasUnpublishedChanges

  return (
    <div className="publish-bar" data-pending={pending ? 'true' : 'false'}>
      <p className="publish-bar-text" role="status">
        {!status.ok
          ? 'Menu status unavailable'
          : status.hasUnpublishedChanges
            ? 'Unpublished changes'
            : `Menu published · version ${status.publishedVersion}`}
      </p>
      {pending && isOwner ? <PublishMenuButton /> : null}
    </div>
  )
}

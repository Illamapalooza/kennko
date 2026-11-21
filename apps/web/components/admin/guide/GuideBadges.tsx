import type { GuideTopic } from '@/app/admin/guide/content'

export function GuideBadges({ topic }: { topic: GuideTopic }) {
  return (
    <ul className="guide-badges" aria-label="Who does this">
      {topic.ownerOnly ? (
        <li className="guide-badge guide-badge-owner">Owner only</li>
      ) : (
        topic.audience.map((a) => (
          <li key={a} className="guide-badge">
            {a}
          </li>
        ))
      )}
    </ul>
  )
}

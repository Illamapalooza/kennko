'use client'

import Link from 'next/link'
import { useState } from 'react'
import type { GuideTopic } from '@/app/admin/guide/content'
import { filterTopics } from '@/app/admin/guide/search'
import { GuideBadges } from './GuideBadges'

export function GuideIndex({ topics }: { topics: GuideTopic[] }) {
  const [query, setQuery] = useState('')
  const shown = filterTopics(topics, query)

  return (
    <>
      <label className="admin-field guide-search">
        <span>Search the guide</span>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Try: void, PIN, offline, free drink"
          autoComplete="off"
        />
      </label>
      <p className="guide-count" aria-live="polite">
        {query.trim() ? `${shown.length} of ${topics.length} topics` : `${topics.length} topics`}
      </p>
      {shown.length === 0 ? (
        <p className="admin-notice">Nothing matches that. Try a shorter word.</p>
      ) : (
        <ol className="guide-list">
          {shown.map((t) => (
            <li key={t.slug}>
              <Link className="guide-card" href={`/admin/guide/${t.slug}`}>
                <strong className="guide-card-title">{t.title}</strong>
                <span className="guide-card-summary">{t.summary}</span>
                <GuideBadges topic={t} />
              </Link>
            </li>
          ))}
        </ol>
      )}
    </>
  )
}

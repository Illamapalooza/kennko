'use client'

import Link from 'next/link'
import { useState } from 'react'
import type { GuideTopic } from '@/app/admin/guide/content'
import type { FaqItem } from '@/app/admin/guide/faq'
import { filterFaq, filterTopics } from '@/app/admin/guide/search'
import { GuideBadges } from './GuideBadges'

export function GuideIndex({ topics, faq }: { topics: GuideTopic[]; faq: FaqItem[] }) {
  const [query, setQuery] = useState('')
  const searching = query.trim() !== ''
  const shown = filterTopics(topics, query)
  const questions = filterFaq(faq, query)

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
        {searching
          ? `${shown.length} of ${topics.length} topics · ${questions.length} questions`
          : `${topics.length} topics · ${faq.length} questions`}
      </p>

      {!searching ? (
        <Link className="guide-card guide-card-faq" href="/admin/guide/faq">
          <strong className="guide-card-title">Questions (FAQ)</strong>
          <span className="guide-card-summary">Quick answers to everyday &ldquo;how do I…?&rdquo; questions.</span>
        </Link>
      ) : null}

      {searching && questions.length > 0 ? (
        <section aria-labelledby="guide-q-results">
          <h2 id="guide-q-results" className="guide-results-title">Questions</h2>
          <ul className="guide-list">
            {questions.map((q) => (
              <li key={q.id}>
                <Link className="guide-card" href={`/admin/guide/faq#${q.id}`}>
                  <strong className="guide-card-title">{q.question}</strong>
                  <span className="guide-card-summary">{q.answer}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {searching && shown.length > 0 ? <h2 className="guide-results-title">Topics</h2> : null}
      {searching && shown.length === 0 && questions.length === 0 ? (
        <p className="admin-notice">Nothing matches that. Try a shorter word.</p>
      ) : shown.length > 0 ? (
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
      ) : null}
    </>
  )
}

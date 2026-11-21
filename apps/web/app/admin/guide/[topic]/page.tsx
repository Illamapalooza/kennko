import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireStaff } from '@/lib/auth/session'
import { GuideBadges } from '@/components/admin/guide/GuideBadges'
import { PrintButton } from '@/components/admin/guide/PrintButton'
import { TOPICS, findTopic } from '../content'

export const dynamic = 'force-dynamic'

export default async function GuideTopicPage({ params }: { params: Promise<{ topic: string }> }) {
  await requireStaff()
  const { topic: slug } = await params
  const topic = findTopic(slug)
  if (!topic) notFound()

  const index = TOPICS.indexOf(topic)
  const prev = TOPICS[index - 1]
  const next = TOPICS[index + 1]

  return (
    <article className="guide guide-topic">
      <div className="guide-toolbar guide-noprint">
        <Link className="btn btn-secondary" href="/admin/guide">
          All topics
        </Link>
        <PrintButton />
      </div>
      <p className="guide-print-brand">Kennko Coffee · Staff guide</p>
      <h1>{topic.title}</h1>
      <GuideBadges topic={topic} />
      <p className="guide-summary">{topic.summary}</p>

      {topic.sections.map((s) => (
        <section key={s.heading} className="guide-section">
          <h2>{s.heading}</h2>
          {s.steps?.length ? (
            <ol className="guide-steps">
              {s.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          ) : null}
          {s.tips?.length ? (
            <div className="guide-box guide-tips">
              <h3>Do it right</h3>
              <ul>
                {s.tips.map((tip) => (
                  <li key={tip}>{tip}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {s.problems?.length ? (
            <div className="guide-box guide-problems">
              <h3>If something goes wrong</h3>
              <dl>
                {s.problems.map((p) => (
                  <div key={p.problem}>
                    <dt>{p.problem}</dt>
                    <dd>{p.fix}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}
        </section>
      ))}

      <nav className="guide-pager guide-noprint" aria-label="More topics">
        {prev ? (
          <Link className="btn btn-secondary" href={`/admin/guide/${prev.slug}`}>
            ← {prev.title}
          </Link>
        ) : (
          <span />
        )}
        {next ? (
          <Link className="btn btn-secondary" href={`/admin/guide/${next.slug}`}>
            {next.title} →
          </Link>
        ) : null}
      </nav>
    </article>
  )
}

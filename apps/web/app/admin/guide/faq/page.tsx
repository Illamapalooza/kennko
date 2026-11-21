import Link from 'next/link'
import { requireStaff } from '@/lib/auth/session'
import { PrintButton } from '@/components/admin/guide/PrintButton'
import { findTopic } from '../content'
import { FAQ } from '../faq'

export const dynamic = 'force-dynamic'

export default async function GuideFaqPage() {
  await requireStaff()
  return (
    <article className="guide guide-topic">
      <div className="guide-toolbar guide-noprint">
        <Link className="btn btn-secondary" href="/admin/guide">
          All topics
        </Link>
        <PrintButton />
      </div>
      <p className="guide-print-brand">Kennko Coffee · Staff guide</p>
      <h1>Questions</h1>
      <p className="guide-summary">Quick answers to everyday &ldquo;how do I…?&rdquo; questions. Each links to the full steps.</p>

      <nav className="guide-faq-groups guide-noprint" aria-label="Question groups">
        {FAQ.map((g, i) => (
          <a key={g.title} className="guide-chip" href={`#group-${i}`}>
            {g.title}
          </a>
        ))}
      </nav>

      {FAQ.map((g, i) => (
        <section key={g.title} id={`group-${i}`} className="guide-section">
          <h2>{g.title}</h2>
          <dl className="guide-faq">
            {g.items.map((item) => {
              const topic = item.topic ? findTopic(item.topic) : undefined
              return (
                <div key={item.id} id={item.id} className="guide-faq-item">
                  <dt>{item.question}</dt>
                  <dd>
                    {item.answer}
                    {topic ? (
                      <>
                        {' '}
                        <Link className="guide-faq-link guide-noprint" href={`/admin/guide/${topic.slug}`}>
                          More: {topic.title}
                        </Link>
                      </>
                    ) : null}
                  </dd>
                </div>
              )
            })}
          </dl>
        </section>
      ))}
    </article>
  )
}

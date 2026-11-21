import { requireStaff } from '@/lib/auth/session'
import { GuideIndex } from '@/components/admin/guide/GuideIndex'
import { TOPICS } from './content'
import { FAQ_ITEMS } from './faq'

export const dynamic = 'force-dynamic'

export default async function GuidePage() {
  await requireStaff()
  return (
    <div className="guide">
      <h1>Guide</h1>
      <p className="guide-intro">
        How to run the till, the website and the wall. Each page has a Print button for the counter.
      </p>
      <GuideIndex topics={TOPICS} faq={FAQ_ITEMS} />
    </div>
  )
}

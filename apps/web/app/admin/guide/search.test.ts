import { describe, expect, it } from 'vitest'
import type { GuideTopic } from './content'
import { TOPICS } from './content'
import { filterFaq, filterTopics } from './search'
import { FAQ_ITEMS } from './faq'

const t = (slug: string, extra: Partial<GuideTopic> = {}): GuideTopic => ({
  slug,
  title: slug,
  audience: ['Barista'],
  summary: '',
  sections: [{ heading: 'H', steps: ['step'] }],
  ...extra,
})

describe('filterTopics', () => {
  const topics = [
    t('alpha', { title: 'Opening the till' }),
    t('beta', { sections: [{ heading: 'Money', steps: ['Tap Void order'] }] }),
    t('gamma', { sections: [{ heading: 'X', problems: [{ problem: 'Offline badge', fix: 'Keep selling' }] }] }),
    t('delta', { audience: ['Owner'], ownerOnly: true }),
  ]

  it('returns everything for an empty or blank query', () => {
    expect(filterTopics(topics, '')).toEqual(topics)
    expect(filterTopics(topics, '   ')).toEqual(topics)
  })

  it('matches the title, steps and problems, ignoring case', () => {
    expect(filterTopics(topics, 'TILL').map((x) => x.slug)).toEqual(['alpha'])
    expect(filterTopics(topics, 'void').map((x) => x.slug)).toEqual(['beta'])
    expect(filterTopics(topics, 'keep selling').map((x) => x.slug)).toEqual(['gamma'])
  })

  it('needs every word to match', () => {
    expect(filterTopics(topics, 'void offline')).toEqual([])
  })

  it('finds owner-only topics by "owner only"', () => {
    expect(filterTopics(topics, 'owner only').map((x) => x.slug)).toEqual(['delta'])
  })

  it('returns nothing when nothing matches', () => {
    expect(filterTopics(topics, 'zzzz')).toEqual([])
  })

  it('finds the real free drink topic', () => {
    expect(filterTopics(TOPICS, 'free drink').map((x) => x.slug)).toContain('kennko-card')
  })
})

describe('filterFaq', () => {
  const items = [
    { id: 'a', question: 'Someone forgot their PIN', answer: 'Tap New PIN' },
    { id: 'b', question: 'A drink ran out', answer: 'Mark sold out' },
  ]

  it('matches nothing for an empty query', () => {
    expect(filterFaq(items, '  ')).toEqual([])
  })

  it('matches questions and answers, ignoring case, needing every word', () => {
    expect(filterFaq(items, 'forgot').map((i) => i.id)).toEqual(['a'])
    expect(filterFaq(items, 'SOLD out').map((i) => i.id)).toEqual(['b'])
    expect(filterFaq(items, 'pin sold')).toEqual([])
  })

  it('finds real FAQ answers', () => {
    expect(filterFaq(FAQ_ITEMS, 'disconnected in admin').map((i) => i.id)).toContain('reconnect-till')
  })
})

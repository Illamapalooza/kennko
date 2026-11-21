import { describe, expect, it } from 'vitest'
import { AUDIENCES, TOPICS, findTopic } from './content'

describe('guide content', () => {
  it('has unique, URL-safe slugs', () => {
    const slugs = TOPICS.map((t) => t.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
    for (const slug of slugs) expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  })

  it('gives every topic a title, summary and known audience', () => {
    for (const t of TOPICS) {
      expect(t.title.trim(), t.slug).not.toBe('')
      expect(t.summary.trim(), t.slug).not.toBe('')
      expect(t.audience.length, t.slug).toBeGreaterThan(0)
      for (const a of t.audience) expect(AUDIENCES).toContain(a)
    }
  })

  it('gives every topic at least one section with steps', () => {
    for (const t of TOPICS) {
      expect(t.sections.some((s) => (s.steps?.length ?? 0) > 0), t.slug).toBe(true)
    }
  })

  it('has no empty sections', () => {
    for (const t of TOPICS) {
      for (const s of t.sections) {
        const n = (s.steps?.length ?? 0) + (s.tips?.length ?? 0) + (s.problems?.length ?? 0)
        expect(n, `${t.slug}: ${s.heading}`).toBeGreaterThan(0)
      }
    }
  })

  it('marks owner-only topics as done by the owner alone', () => {
    for (const t of TOPICS.filter((x) => x.ownerOnly)) expect(t.audience).toEqual(['Owner'])
    expect(findTopic('first-time-setup')?.ownerOnly).toBe(true)
  })

  it('finds a topic by slug and nothing for an unknown one', () => {
    expect(findTopic('troubleshooting')?.title).toBe('Troubleshooting')
    expect(findTopic('nope')).toBeUndefined()
  })
})

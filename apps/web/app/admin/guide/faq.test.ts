import { describe, expect, it } from 'vitest'
import { findTopic } from './content'
import { FAQ, FAQ_ITEMS } from './faq'

describe('guide FAQ', () => {
  it('has unique questions', () => {
    const qs = FAQ_ITEMS.map((i) => i.question.trim().toLowerCase())
    expect(new Set(qs).size).toBe(qs.length)
  })

  it('has unique, URL-safe anchors', () => {
    const ids = FAQ_ITEMS.map((i) => i.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  })

  it('gives every question a non-empty answer', () => {
    for (const i of FAQ_ITEMS) {
      expect(i.question.trim(), i.id).not.toBe('')
      expect(i.answer.trim(), i.id).not.toBe('')
    }
  })

  it('only links to topics that exist', () => {
    for (const i of FAQ_ITEMS) if (i.topic) expect(findTopic(i.topic), `${i.id} -> ${i.topic}`).toBeDefined()
  })

  it('has no empty groups', () => {
    for (const g of FAQ) expect(g.items.length, g.title).toBeGreaterThan(0)
  })
})

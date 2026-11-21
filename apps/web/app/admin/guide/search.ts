import type { GuideTopic } from './content'

/** Every word a topic can be found by: title, audience, summary and all its sections. */
export function topicText(topic: GuideTopic): string {
  const parts: string[] = [topic.title, topic.summary, ...topic.audience]
  if (topic.ownerOnly) parts.push('Owner only')
  for (const s of topic.sections) {
    parts.push(s.heading, ...(s.steps ?? []), ...(s.tips ?? []))
    for (const p of s.problems ?? []) parts.push(p.problem, p.fix)
  }
  return parts.join(' ').toLowerCase()
}

/** Topics matching every word of the query, in their original order. An empty query matches all. */
export function filterTopics(topics: GuideTopic[], query: string): GuideTopic[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return topics
  return topics.filter((t) => {
    const text = topicText(t)
    return words.every((w) => text.includes(w))
  })
}

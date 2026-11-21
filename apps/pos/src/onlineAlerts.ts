export type AlertMemory = { seen: string[] }
export const ALERT_KEY = 'kennko-online-seen'
const MAX_SEEN = 200

export function nextOnlineAlerts(
  memory: AlertMemory | null,
  online: { id: string; label: string }[],
): { memory: AlertMemory; fresh: string[] } {
  if (memory === null) {
    return { memory: { seen: online.map((o) => o.id).slice(-MAX_SEEN) }, fresh: [] }
  }
  const known = new Set(memory.seen)
  const fresh: string[] = []
  const nextSeen = [...memory.seen]
  for (const item of online) {
    if (!known.has(item.id)) {
      known.add(item.id)
      nextSeen.push(item.id)
      fresh.push(item.label)
    }
  }
  return {
    memory: { seen: nextSeen.slice(-MAX_SEEN) },
    fresh,
  }
}

export function bannerText(fresh: string[]): string {
  if (fresh.length === 1) return `New online order ${fresh[0]}`
  return `${fresh.length} new online orders`
}

export function loadAlertMemory(): AlertMemory | null {
  try {
    const raw = localStorage.getItem(ALERT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (parsed && Array.isArray(parsed.seen) && parsed.seen.every((x: unknown) => typeof x === 'string')) {
      return { seen: parsed.seen }
    }
  } catch { /* ignore */ }
  return null
}

export function saveAlertMemory(m: AlertMemory | null): void {
  try {
    if (m === null) localStorage.removeItem(ALERT_KEY)
    else localStorage.setItem(ALERT_KEY, JSON.stringify(m))
  } catch { /* ignore */ }
}

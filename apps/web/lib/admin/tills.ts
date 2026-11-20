export type TillView = {
  id: string
  name: string
  status: 'waiting' | 'expired' | 'paired'
  expiresAt: string | null
  pairedAt: string | null
  lastSeenAt: string | null
}

/** 482913 -> "482 913" so it reads aloud in two halves. */
export function spacedCode(code: string): string {
  return code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code
}

/** Whole seconds left until `expiresAt`, never negative. */
export function secondsLeft(expiresAt: string, now: number): number {
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now) / 1000))
}

/** 581 -> "9:41". */
export function formatCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function ago(iso: string, now: number): string {
  const minutes = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000))
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  return `${Math.floor(hours / 24)} d ago`
}

export function tillStatus(till: TillView, now: number): string {
  if (till.status === 'waiting') return 'Waiting for the code'
  if (till.status === 'expired') return 'Code expired'
  return till.lastSeenAt ? `Connected · last seen ${ago(till.lastSeenAt, now)}` : 'Connected · not seen yet'
}

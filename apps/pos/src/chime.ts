let ctx: AudioContext | null = null

function ensureContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return null
  if (!ctx) ctx = new Ctor()
  if (ctx.state === 'suspended') ctx.resume().catch(() => {})
  return ctx
}

if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', () => { ensureContext() }, { once: true, passive: true })
}

export function playChime(): void {
  const c = ensureContext()
  if (!c) return
  try {
    const now = c.currentTime
    const notes = [659.25, 880] // E5 -> A5
    notes.forEach((freq, i) => {
      const osc = c.createOscillator()
      const gain = c.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(freq, now + i * 0.11)
      gain.gain.setValueAtTime(0.0001, now + i * 0.11)
      gain.gain.exponentialRampToValueAtTime(0.12, now + i * 0.11 + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.11 + 0.24)
      osc.connect(gain)
      gain.connect(c.destination)
      osc.start(now + i * 0.11)
      osc.stop(now + i * 0.11 + 0.25)
    })
  } catch { /* ignore */ }
}

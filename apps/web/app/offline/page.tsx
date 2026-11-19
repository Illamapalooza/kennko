import type { Metadata } from 'next'

export const metadata: Metadata = { title: "You're offline", robots: { index: false } }

// Self-contained on purpose: this page is shown with no network, so it cannot rely on stylesheets
// that were never saved. Colours are the brand tokens written out.
const css = `
.offline{min-height:100vh;display:grid;place-items:center;padding:24px;background:#fff5f0;font-family:var(--font-nunito),system-ui,sans-serif;color:#0d1b3d}
.offline-card{max-width:420px;text-align:center;background:#fff;border:3px solid #0d1b3d;border-radius:20px;box-shadow:0 6px 0 #0d1b3d;padding:32px 24px}
.offline-card img{height:48px;width:auto}
.offline-card h1{margin:20px 0 8px;font-size:1.75rem;font-weight:900;color:#0055ff}
.offline-card p{margin:0;line-height:1.5}
`

export default function OfflinePage() {
  return (
    <main className="offline">
      <style>{css}</style>
      <div className="offline-card k-sticker">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/wordmark-blue.png" alt="Kennko Coffee" width={536} height={163} />
        <h1>You&apos;re offline</h1>
        <p>Kennko will be right here when you&apos;re back online.</p>
      </div>
    </main>
  )
}

import { useEffect, useState } from 'react'
import { api } from '../api.ts'
import { Modal } from './Modal.tsx'

type CheckinQr = { url: string; modules: string[] }

function QrMatrix({ modules }: { modules: string[] }) {
  const n = modules.length
  if (n === 0) return null
  const quiet = 3
  const size = n + quiet * 2
  const rects: React.JSX.Element[] = []
  for (let r = 0; r < n; r++) {
    const row = modules[r]
    for (let c = 0; c < row.length; c++) {
      if (row[c] === '1') {
        rects.push(<rect key={`${r}-${c}`} x={c + quiet} y={r + quiet} width={1} height={1} fill="#0a0a0a" />)
      }
    }
  }
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      width={280}
      height={280}
      shapeRendering="crispEdges"
      role="img"
      aria-label="Walk your cat in QR code"
      style={{
        display: 'block',
        background: '#ffffff',
        borderRadius: 16,
        border: '2px solid #0f172a',
        boxShadow: '0 6px 20px rgba(0, 85, 255, 0.12)',
      }}
    >
      <rect x={0} y={0} width={size} height={size} fill="#ffffff" />
      {rects}
    </svg>
  )
}

export function WalkCatModal({ onClose }: { onClose: () => void }) {
  const [qr, setQr] = useState<CheckinQr | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const res = await api.checkinQr()
        if (!alive) return
        setQr(res.checkin)
        setError(res.checkin ? '' : 'Check-in QR is not ready yet. Make sure this till is connected to Kennko and tap Menu → Check now.')
      } catch (err) {
        if (!alive) return
        setError(err instanceof Error ? err.message : 'Could not load check-in QR.')
      } finally {
        if (alive) setLoading(false)
      }
    }
    void load()
    const timer = window.setInterval(load, 15_000)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [])

  return (
    <Modal title="Walk your cat in" onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, textAlign: 'center', padding: '4px 0' }}>
        <p style={{ margin: 0, fontWeight: 700, fontSize: 16, color: '#0055FF' }}>
          Scan to walk your cat into Kennko &amp; earn +15 pts!
        </p>
        {loading ? (
          <p className="muted" style={{ margin: '24px 0' }}>Loading QR code…</p>
        ) : qr ? (
          <>
            <QrMatrix modules={qr.modules} />
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>
              Refreshes automatically every minute · {qr.url.replace(/^https?:\/\//, '')}
            </p>
          </>
        ) : (
          <p className="note-amber" role="status" style={{ margin: '12px 0' }}>{error}</p>
        )}
        <button type="button" className="btn btn-primary" onClick={onClose} style={{ minWidth: 140 }}>
          Done
        </button>
      </div>
    </Modal>
  )
}

'use client'

import { useEffect, useRef, useState } from 'react'
import type { CatLook } from '@kennko/core'
import { BARISTA_COSMETICS, COAT_KEYS, COSMETICS, drawCat, CAT_W, CAT_H } from '@kennko/cats/pixel'

const LABELS: Record<string, string> = {
  // Coats
  ginger: 'Ginger',
  tuxedo: 'Tuxedo',
  tabby: 'Tabby',
  white: 'White',
  calico: 'Calico',
  siamese: 'Siamese',
  black: 'Black',
  cream: 'Cream',
  // Barista Exclusives
  'barista-cap': 'Barista Cap ★',
  'chef-beret': 'Roaster Beret ★',
  'owner-crown': 'Owner Crown ★',
  'barista-shades': 'Barista Shades ★',
  headset: 'Counter Headset ★',
  'gold-apron': 'Gold Apron ★',
  'coffee-pin': 'Coffee Bean Pin ★',
  portafilter: 'Portafilter ★',
  'milk-pitcher': 'Milk Pitcher ★',
  tamper: 'Espresso Tamper ★',
  // Standard cosmetics
  beanie: 'Beanie',
  'party-hat': 'Party Hat',
  visor: 'Visor',
  'flower-crown': 'Flower Crown',
  crown: 'Crown',
  blush: 'Blush',
  'round-glasses': 'Round Glasses',
  sunnies: 'Sunnies',
  bandana: 'Bandana',
  'bow-tie': 'Bow Tie',
  'bell-collar': 'Bell Collar',
  'kennko-cup': 'Kennko Cup',
  croissant: 'Croissant',
  fish: 'Fish',
}

type OverlaySlot = 'hat' | 'face' | 'neck' | 'held'
const OVERLAY_SLOTS: { key: OverlaySlot; label: string }[] = [
  { key: 'hat', label: 'Hat' },
  { key: 'face', label: 'Face' },
  { key: 'neck', label: 'Neck / Apron' },
  { key: 'held', label: 'Held Item' },
]

function slotOptions(slot: OverlaySlot): string[] {
  const exclusive = Object.keys(BARISTA_COSMETICS).filter((k) => BARISTA_COSMETICS[k].slot === slot)
  const standard = Object.keys(COSMETICS).filter((k) => COSMETICS[k].slot === slot)
  return [...exclusive, ...standard]
}

function PixelPreview({ look }: { look: CatLook }) {
  const ref = useRef<HTMLCanvasElement | null>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.imageSmoothingEnabled = false
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.save()
    ctx.scale(5, 5)
    drawCat(ctx, 4, 4, look, { apron: true })
    ctx.restore()
  }, [look])

  return (
    <canvas
      ref={ref}
      width={(CAT_W + 8) * 5}
      height={(CAT_H + 8) * 5}
      style={{
        imageRendering: 'pixelated',
        background: '#eef4ff',
        border: '2px solid #0d1b3d',
        borderRadius: 12,
        display: 'block',
      }}
      aria-label="Barista cat preview"
    />
  )
}

export function StaffCatCustomizer({
  staffName,
  initialLook,
  pending,
  onSave,
  onClose,
}: {
  staffName: string
  initialLook: CatLook | null
  pending: boolean
  onSave: (look: CatLook) => void
  onClose: () => void
}) {
  const [look, setLook] = useState<CatLook>(initialLook ?? { coat: 'tuxedo' })

  const setSlot = (slot: OverlaySlot, value: string) => {
    setLook((prev) => {
      const next: CatLook = { ...prev }
      if (!value) delete next[slot]
      else next[slot] = value
      return next
    })
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Customize barista cat for ${staffName}`}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 60,
        background: 'rgba(13, 27, 61, 0.55)',
        display: 'grid',
        placeItems: 'center',
        padding: 16,
      }}
    >
      <div
        style={{
          background: '#fff',
          border: '2px solid #0d1b3d',
          borderRadius: 16,
          padding: 20,
          width: 'min(480px, 100%)',
          maxHeight: '90vh',
          overflowY: 'auto',
          display: 'grid',
          gap: 14,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.15rem' }}>{staffName}&apos;s Barista Cat</h2>
            <small style={{ color: '#555' }}>★ = Barista &amp; Owner exclusive cosmetics</small>
          </div>
          <PixelPreview look={look} />
        </div>

        <label style={{ display: 'grid', gap: 4, fontWeight: 700, fontSize: '0.9rem' }}>
          Coat
          <select value={look.coat} onChange={(e) => setLook((prev) => ({ ...prev, coat: e.target.value }))}>
            {COAT_KEYS.map((k) => (
              <option key={k} value={k}>
                {LABELS[k] ?? k}
              </option>
            ))}
          </select>
        </label>

        {OVERLAY_SLOTS.map(({ key, label }) => (
          <label key={key} style={{ display: 'grid', gap: 4, fontWeight: 700, fontSize: '0.9rem' }}>
            {label}
            <select value={look[key] ?? ''} onChange={(e) => setSlot(key, e.target.value)}>
              <option value="">None</option>
              {slotOptions(key).map((k) => (
                <option key={k} value={k}>
                  {LABELS[k] ?? k}
                </option>
              ))}
            </select>
          </label>
        ))}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
          <button type="button" className="btn btn-secondary" disabled={pending} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={pending} onClick={() => onSave(look)}>
            {pending ? 'Saving…' : 'Save barista cat'}
          </button>
        </div>
      </div>
    </div>
  )
}

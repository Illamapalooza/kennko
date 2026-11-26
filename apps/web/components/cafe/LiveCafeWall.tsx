'use client'

import { useEffect, useRef, useState } from 'react'
import { CatToon } from '@kennko/cats'
import { nextOpeningText } from '@kennko/core'
import { createScene } from '@/lib/cafe/scene/scene.mjs'
import { boardView, deliveryView, itemsLabel, type WallBoardOrder } from '@/lib/cafe/scene/logic.mjs'

type WallPayload = {
  now: number
  baristas: number
  baristaCats?: Array<{ name: string; look: { coat: string; hat?: string; face?: string; neck?: string; held?: string } }>
  openNow?: boolean
  isOpen?: boolean
  closingTime?: string | null
  orders: WallBoardOrder[]
  visitors: Array<{ key: string; name: string; look: { coat: string }; endsAt: number }>
  offline?: boolean
}

const POLL_MS = 10_000
const BOARD_CAP = 5

const DELIVERY_STAGE: Record<string, string> = {
  placed: 'Queued',
  preparing: 'Preparing',
  ready: 'Ready',
  out_for_delivery: 'Out for delivery',
}

function shownNumber(o: WallBoardOrder): string {
  return o.label || String(o.number)
}

export function LiveCafeWall({ initial }: { initial: WallPayload }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const tagsRef = useRef<HTMLDivElement>(null)
  const [snap, setSnap] = useState<WallPayload>(initial)
  const clockSkewRef = useRef(initial.now ? initial.now - Date.now() : 0)

  useEffect(() => {
    let alive = true
    const pull = async () => {
      try {
        const res = await fetch('/api/wall', { cache: 'no-store' })
        if (!res.ok) return
        const next = (await res.json()) as WallPayload
        if (!alive) return
        if (next.now) clockSkewRef.current = next.now - Date.now()
        setSnap(next)
      } catch {
        /* keep showing last frame */
      }
    }
    const timer = setInterval(pull, POLL_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [])

  const sceneRef = useRef<ReturnType<typeof createScene> | null>(null)

  // The scene runs its own animation loop and draws the labels into the tag layer.
  useEffect(() => {
    const canvas = canvasRef.current
    const tagLayer = tagsRef.current
    if (!canvas || !tagLayer) return
    const scene = createScene(canvas, tagLayer, { clock: () => Date.now() + clockSkewRef.current })
    sceneRef.current = scene
    scene.sync(initial.orders, initial.baristas, true, initial.visitors, initial.baristaCats ?? [])
    return () => {
      scene.destroy()
      sceneRef.current = null
    }
  }, [initial])

  useEffect(() => {
    sceneRef.current?.sync(snap.orders, snap.baristas, false, snap.visitors, snap.baristaCats ?? [])
  }, [snap])

  const closed = snap.openNow === false
  const view = boardView(snap.orders, BOARD_CAP)
  const deliveries = deliveryView(snap.orders)

  return (
    <div className="cafe-shell">
      <div className="cafe-status-bar">
        <span className={`cafe-pill${closed ? ' is-closed' : ''}`}>
          {snap.offline ? 'Live feed unavailable' : closed ? 'Kennko is closed' : 'Live from Kennko Butuan'}
        </span>
        <span className="cafe-meta">
          {closed
            ? nextOpeningText(snap.now || Date.now())
            : `Updates every ${POLL_MS / 1000} seconds · ${snap.visitors.length} visiting cat${snap.visitors.length === 1 ? '' : 's'}`}
        </span>
      </div>

      {closed ? (
        <section className="cafe-closed-hero" aria-live="polite">
          <div className="cafe-frame cafe-frame-closed">
            <canvas ref={canvasRef} width={288} height={152} role="img" aria-label="Kennko cat cafe closed for the night" />
            <div ref={tagsRef} className="cafe-tags" aria-hidden="true" />
            <div className="cafe-closed-overlay">
              <CatToon coat="calico" pose="nap" className="cafe-closed-cat" />
              <h1>Kennko is closed. See you tomorrow!</h1>
              <p>{nextOpeningText(snap.now || Date.now())}</p>
            </div>
          </div>
        </section>
      ) : (
        <>
          {deliveries.length > 0 ? (
            <section className="cafe-deliveries" aria-label="Online deliveries">
              <h2>Online deliveries</h2>
              <ul>
                {deliveries.slice(0, 6).map((o) => (
                  <li key={o.id}>
                    <strong>{shownNumber(o)}</strong>
                    <em>{DELIVERY_STAGE[o.prepStatus ?? ''] ?? 'Preparing'}</em>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <div className="cafe-grid">
            <section className="cafe-stage">
              <div className="cafe-frame">
                <canvas ref={canvasRef} width={288} height={152} role="img" aria-label="Live Kennko cat cafe" />
                <div ref={tagsRef} className="cafe-tags" aria-hidden="true" />
              </div>
            </section>

            <aside className="cafe-board" aria-live="polite">
              <section className="cafe-col">
                <h2>Now preparing</h2>
                <ol className="cafe-rows">
                  {view.preparing.shown.length === 0 ? <li className="cafe-empty">—</li> : null}
                  {view.preparing.shown.map((o) => (
                    <li key={o.id}>
                      <strong>{shownNumber(o)}</strong>
                      <div><b>{itemsLabel(o.items)}</b></div>
                    </li>
                  ))}
                </ol>
                {view.preparing.more > 0 ? <p className="cafe-more">+{view.preparing.more} more</p> : null}
              </section>

              <section className="cafe-col cafe-serving">
                <h2>Now serving</h2>
                <ol className="cafe-rows">
                  {view.serving.shown.length === 0 ? <li className="cafe-empty">—</li> : null}
                  {view.serving.shown.map((o) => (
                    <li key={o.id}>
                      <strong>{shownNumber(o)}</strong>
                      <div><b>{itemsLabel(o.items)}</b></div>
                    </li>
                  ))}
                </ol>
                {view.serving.more > 0 ? <p className="cafe-more">+{view.serving.more} more</p> : null}
              </section>

              <section className="cafe-col">
                <h2>In line</h2>
                <p className="cafe-chips">
                  {view.queued.shown.length === 0 ? <span className="cafe-none">No one waiting</span> : null}
                  {view.queued.shown.map((o) => <span key={o.id}>{shownNumber(o)}</span>)}
                  {view.queued.more > 0 ? <span>+{view.queued.more}</span> : null}
                </p>
              </section>
            </aside>
          </div>
        </>
      )}
    </div>
  )
}

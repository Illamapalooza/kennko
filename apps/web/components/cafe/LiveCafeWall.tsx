'use client'

import { useEffect, useRef, useState } from 'react'
import { createScene } from '@/lib/cafe/scene/scene.mjs'
import { boardView, deliveryView, itemsLabel, type WallBoardOrder } from '@/lib/cafe/scene/logic.mjs'

type WallPayload = {
  now: number
  baristas: number
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

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const scene = createScene(canvas, {
      ambient: false,
      clock: () => Date.now() + clockSkewRef.current,
    })
    sceneRef.current = scene
    scene.sync(initial.orders, initial.baristas, true, initial.visitors)

    let last = performance.now()
    let raf = 0
    const frame = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      scene.tick(dt)
      scene.draw()
      const tagsEl = tagsRef.current
      if (tagsEl) {
        const all = [
          ...scene.tags().map((t) => ({ key: `o:${t.id}`, label: t.text, ready: t.ready, bubble: false, x: t.x, y: t.y })),
          ...scene.visitorTags().map((v) => ({ key: `v:${v.key}`, label: v.name, ready: false, bubble: true, x: v.x, y: v.y })),
        ]
        tagsEl.replaceChildren(
          ...all.map((item) => {
            const span = document.createElement('span')
            span.className = `cafe-tag${item.ready ? ' ready' : ''}${item.bubble ? ' bubble' : ''}`
            span.textContent = item.label
            span.style.left = `${(item.x / 288) * 100}%`
            span.style.top = `${(item.y / 152) * 100}%`
            return span
          }),
        )
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      sceneRef.current = null
    }
  }, [initial])

  useEffect(() => {
    sceneRef.current?.sync(snap.orders, snap.baristas, false, snap.visitors)
  }, [snap])

  const closed = snap.baristas === 0
  const view = boardView(snap.orders, BOARD_CAP)
  const deliveries = deliveryView(snap.orders)

  return (
    <div className="cafe-shell">
      <div className="cafe-status-bar">
        <span className={`cafe-pill${closed ? ' is-closed' : ''}`}>
          {snap.offline ? 'Live feed unavailable' : closed ? 'Shop closed · Cat nap' : 'Live from Kennko Butuan'}
        </span>
        <span className="cafe-meta">Updates about every 15s · {snap.visitors.length} visiting cat{snap.visitors.length === 1 ? '' : 's'}</span>
      </div>

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

        <aside className={`cafe-board${closed ? ' is-closed' : ''}`} aria-live="polite">
          {closed ? (
            <div className="cafe-closed">
              <img src="/brand/cats/nap-calico.svg" alt="" className="cafe-closed-cat" />
              <h2>Cat nap</h2>
              <p>Our baristas are resting. Check back during shop hours!</p>
            </div>
          ) : (
            <>
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
            </>
          )}
        </aside>
      </div>
    </div>
  )
}

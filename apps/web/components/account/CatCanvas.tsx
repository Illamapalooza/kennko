'use client'

import { useEffect, useRef } from 'react'
import { catBounds, drawCat } from '@kennko/cats/pixel'
import type { CatLook } from '@kennko/core'

/** The cat drawn from the shared pixel module, crisp at a whole-number scale. */
export function CatCanvas({ look, label, scale = 10 }: { look: CatLook; label: string; scale?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const b = catBounds(look)
  const w = b.x1 - b.x0 + 1
  const h = b.y1 - b.y0 + 1

  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.imageSmoothingEnabled = false
    ctx.setTransform(scale, 0, 0, scale, 0, 0)
    drawCat(ctx, -b.x0, -b.y0, look)
  }, [look, scale, b.x0, b.y0])

  return (
    <canvas
      ref={ref}
      className="cat-canvas"
      width={w * scale}
      height={h * scale}
      role="img"
      aria-label={label}
    />
  )
}

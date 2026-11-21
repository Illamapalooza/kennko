import { useEffect, useRef, useState } from 'react'
import jsQR from 'jsqr'

type Props = {
  /** Called for every QR the camera reads. Return true to take it (the camera then stops); false keeps scanning. */
  accept: (text: string) => boolean
}

const NOTE = 'Camera works on the secure address (https://…:4443)'
const FRAME_MS = 200

/**
 * Reads a customer's QR with the back camera, looking at a frame every 200 ms. It stops the camera when it takes a
 * code and when it goes away. Without the secure address, or when the camera is denied, it shows a note and the
 * typed code beside it carries on working.
 */
export function QrScanner({ accept }: Props) {
  const video = useRef<HTMLVideoElement>(null)
  const acceptRef = useRef(accept)
  acceptRef.current = accept
  const [state, setState] = useState<'starting' | 'live' | 'off'>(() => (window.isSecureContext && navigator.mediaDevices ? 'starting' : 'off'))

  useEffect(() => {
    if (!window.isSecureContext || !navigator.mediaDevices) return
    let stream: MediaStream | null = null
    let timer: ReturnType<typeof setInterval> | undefined
    let gone = false
    const stop = () => {
      if (timer) clearInterval(timer)
      stream?.getTracks().forEach((t) => t.stop())
      stream = null
    }
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d', { willReadFrequently: true })

    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }).then(async (s) => {
      if (gone) { s.getTracks().forEach((t) => t.stop()); return }
      stream = s
      const el = video.current
      if (!el || !ctx) { stop(); setState('off'); return }
      el.srcObject = s
      try { await el.play() } catch { /* autoplay refusals still show a frame once visible */ }
      setState('live')
      timer = setInterval(() => {
        if (el.readyState < 2 || !el.videoWidth) return
        const scale = Math.min(1, 640 / el.videoWidth)
        canvas.width = Math.round(el.videoWidth * scale)
        canvas.height = Math.round(el.videoHeight * scale)
        ctx.drawImage(el, 0, 0, canvas.width, canvas.height)
        const frame = ctx.getImageData(0, 0, canvas.width, canvas.height)
        const found = jsQR(frame.data, frame.width, frame.height, { inversionAttempts: 'dontInvert' })
        if (found?.data && acceptRef.current(found.data)) stop()
      }, FRAME_MS)
    }).catch(() => { if (!gone) setState('off') })

    return () => { gone = true; stop() }
  }, [])

  if (state === 'off') return <p className="muted scan-note">{NOTE}</p>
  return (
    <div className="scanner">
      <video ref={video} playsInline muted aria-label="Camera" />
      {state === 'starting' ? <p className="scan-wait">Starting camera…</p> : <span className="scan-frame" aria-hidden="true" />}
    </div>
  )
}

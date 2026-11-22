import { useEffect, useRef, useState } from 'react'
import jsQR from 'jsqr'

type Props = {
  /** Called for every QR the camera reads. Return true to take it (the camera then stops); false keeps scanning. */
  accept: (text: string) => boolean
}

type BarcodeDetectorLike = {
  detect(source: HTMLVideoElement): Promise<Array<{ rawValue?: string }>>
}

type BarcodeDetectorCtor = new (opts?: { formats?: string[] }) => BarcodeDetectorLike

const INSECURE_NOTE = 'Camera works on the secure address (https://…:4443)'
const DENIED_NOTE = 'Camera unavailable or permission denied. Check tablet Camera permissions, or type the code below.'
const FRAME_MS = 180

async function openCameraStream(facing: 'environment' | 'user'): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facing } } })
  } catch {
    return await navigator.mediaDevices.getUserMedia({ video: true })
  }
}

/**
 * Reads a customer's QR with the camera, looking at a frame every 180 ms. Prefers the browser's native
 * BarcodeDetector when available and falls back to jsQR. Stops when it takes a code or unmounts.
 */
export function QrScanner({ accept }: Props) {
  const video = useRef<HTMLVideoElement>(null)
  const acceptRef = useRef(accept)
  acceptRef.current = accept
  const [facing, setFacing] = useState<'environment' | 'user'>('environment')
  const [state, setState] = useState<'starting' | 'live' | 'off'>(() => (window.isSecureContext && navigator.mediaDevices ? 'starting' : 'off'))
  const [note, setNote] = useState(() => (window.isSecureContext && navigator.mediaDevices ? DENIED_NOTE : INSECURE_NOTE))

  useEffect(() => {
    if (!window.isSecureContext || !navigator.mediaDevices) {
      setState('off')
      setNote(INSECURE_NOTE)
      return
    }
    setState('starting')
    let stream: MediaStream | null = null
    let timer: ReturnType<typeof setInterval> | undefined
    let gone = false
    let busy = false
    const stop = () => {
      if (timer) clearInterval(timer)
      stream?.getTracks().forEach((t) => t.stop())
      stream = null
    }
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    const Detector = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector
    const detector = Detector ? new Detector({ formats: ['qr_code'] }) : null

    openCameraStream(facing).then(async (s) => {
      if (gone) { s.getTracks().forEach((t) => t.stop()); return }
      stream = s
      const el = video.current
      if (!el || !ctx) { stop(); setState('off'); return }
      el.srcObject = s
      try { await el.play() } catch { /* autoplay refusals still show a frame once visible */ }
      setState('live')
      timer = setInterval(async () => {
        if (busy || el.readyState < 2 || !el.videoWidth) return
        busy = true
        try {
          if (detector) {
            try {
              const codes = await detector.detect(el)
              for (const c of codes) {
                if (c.rawValue && acceptRef.current(c.rawValue)) { stop(); return }
              }
            } catch { /* fall through to jsQR */ }
          }
          const scale = Math.min(1, 960 / el.videoWidth)
          canvas.width = Math.round(el.videoWidth * scale)
          canvas.height = Math.round(el.videoHeight * scale)
          ctx.drawImage(el, 0, 0, canvas.width, canvas.height)
          const frame = ctx.getImageData(0, 0, canvas.width, canvas.height)
          const found = jsQR(frame.data, frame.width, frame.height, { inversionAttempts: 'attemptBoth' })
          if (found?.data && acceptRef.current(found.data)) stop()
        } finally {
          busy = false
        }
      }, FRAME_MS)
    }).catch(() => {
      if (!gone) {
        setNote(DENIED_NOTE)
        setState('off')
      }
    })

    return () => { gone = true; stop() }
  }, [facing])

  if (state === 'off') return <p className="muted scan-note">{note}</p>
  return (
    <div className="scanner">
      <video ref={video} playsInline muted aria-label="Camera" />
      {state === 'starting' ? <p className="scan-wait">Starting camera…</p> : <span className="scan-frame" aria-hidden="true" />}
      <button type="button" className="scan-flip" onClick={() => setFacing((f) => (f === 'environment' ? 'user' : 'environment'))}>
        Flip camera
      </button>
    </div>
  )
}

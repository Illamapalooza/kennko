import { useEffect, useRef, type ReactNode } from 'react'

type Props = {
  title: string
  onClose: () => void
  children: ReactNode
  /** "wide" suits two-column content on a tablet. */
  size?: 'normal' | 'wide'
  footer?: ReactNode
}

export function Modal({ title, onClose, children, size = 'normal', footer }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCloseRef.current() }
    document.addEventListener('keydown', onKey)
    if (!ref.current?.contains(document.activeElement)) {
      ref.current?.focus()
    }
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="overlay" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className={`sheet sheet-${size}`} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}>
        <header className="sheet-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </header>
        <div className="sheet-body">{children}</div>
        {footer ? <footer className="sheet-foot">{footer}</footer> : null}
      </div>
    </div>
  )
}

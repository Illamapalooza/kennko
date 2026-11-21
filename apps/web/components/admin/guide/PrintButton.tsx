'use client'

export function PrintButton() {
  return (
    <button type="button" className="btn btn-primary guide-print" onClick={() => window.print()}>
      Print
    </button>
  )
}

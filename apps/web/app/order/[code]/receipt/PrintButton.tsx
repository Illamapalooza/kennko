'use client'

export function PrintButton() {
  return (
    <button type="button" className="sheet-add receipt-print" onClick={() => window.print()}>
      Print or save as PDF
    </button>
  )
}

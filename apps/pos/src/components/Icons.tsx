import type { ReactNode } from 'react'

const Svg = ({ children }: { children: ReactNode }) => (
  <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
)

export const CupIcon = () => <Svg><path d="M5 8h12l-1 10a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3L5 8Z" /><path d="M17 10h1.5a2.5 2.5 0 0 1 0 5H16.5" /><path d="M9 3v2M13 3v2" /></Svg>
export const TicketIcon = () => <Svg><rect x="5" y="3" width="14" height="18" rx="3" /><path d="M9 8h6M9 12h6M9 16h3" /></Svg>
export const ClockIcon = () => <Svg><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></Svg>
export const DrawerIcon = () => <Svg><rect x="3" y="6" width="18" height="13" rx="3" /><path d="M3 12h18M10 15.5h4" /></Svg>
export const ListIcon = () => <Svg><path d="M8 6h12M8 12h12M8 18h12" /><circle cx="4" cy="6" r="0.6" /><circle cx="4" cy="12" r="0.6" /><circle cx="4" cy="18" r="0.6" /></Svg>
export const LockIcon = () => <Svg><rect x="5" y="11" width="14" height="10" rx="3" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></Svg>
export const BackspaceIcon = () => <Svg><path d="M9 5h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6-7 6-7Z" /><path d="m12 9 5 6M17 9l-5 6" /></Svg>

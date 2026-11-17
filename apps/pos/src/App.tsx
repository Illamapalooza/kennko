import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Discount, LineInput, Menu, OrderType } from '@kennko/core'
import { api, getPin, setOnLocked, setPin, type Bootstrap, type Live } from './api.ts'
import { ClockIcon, CupIcon, DrawerIcon, ListIcon, LockIcon, TicketIcon } from './components/Icons.tsx'
import { Gate } from './screens/Gate.tsx'
import { Sell } from './screens/Sell.tsx'
import { Orders } from './screens/Orders.tsx'
import { History } from './screens/History.tsx'
import { Till } from './screens/Till.tsx'
import { MenuScreen } from './screens/MenuScreen.tsx'

export type CartLine = LineInput & { key: string }
export type Cart = { lines: CartLine[]; type: OrderType; customerName: string; discount: Discount | null }
export const EMPTY_CART: Cart = { lines: [], type: 'dine_in', customerName: '', discount: null }

type Tab = 'sell' | 'orders' | 'history' | 'till' | 'menu'
const TABS: { id: Tab; label: string; icon: () => React.JSX.Element }[] = [
  { id: 'sell', label: 'Sell', icon: CupIcon },
  { id: 'orders', label: 'Orders', icon: TicketIcon },
  { id: 'history', label: 'History', icon: ClockIcon },
  { id: 'till', label: 'Till', icon: DrawerIcon },
  { id: 'menu', label: 'Menu', icon: ListIcon },
]

export function App() {
  const [boot, setBoot] = useState<Bootstrap | null>(null)
  const [bootError, setBootError] = useState('')
  const [unlocked, setUnlocked] = useState(false)
  const [menu, setMenu] = useState<Menu | null>(null)
  const [live, setLive] = useState<Live | null>(null)
  const [online, setOnline] = useState(true)
  const [tab, setTab] = useState<Tab>('sell')
  const [cart, setCart] = useState<Cart>(EMPTY_CART)
  const [toast, setToast] = useState('')

  const notify = useCallback((message: string) => setToast(message), [])
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(''), 4000)
    return () => clearTimeout(timer)
  }, [toast])

  const lock = useCallback(() => { setPin(''); setUnlocked(false) }, [])
  useEffect(() => { setOnLocked(() => setUnlocked(false)) }, [])

  // Start: learn about the shop, then try the PIN this device remembered.
  useEffect(() => {
    let cancelled = false
    const start = async () => {
      try {
        const b = await api.bootstrap()
        if (cancelled) return
        setBoot(b)
        setBootError('')
        if (!b.pinRequired) return setUnlocked(true)
        if (getPin()) {
          try { await api.checkPin(getPin()); if (!cancelled) setUnlocked(true) } catch { setPin('') }
        }
      } catch (err) {
        if (cancelled) return
        setBootError(err instanceof Error ? err.message : 'Could not start.')
        setTimeout(start, 3000)
      }
    }
    start()
    return () => { cancelled = true }
  }, [])

  // Live feed: every tablet sees the same queue and the same till within a second.
  useEffect(() => {
    if (!unlocked) return
    const source = new EventSource(api.eventsUrl())
    source.onmessage = (event) => { setLive(JSON.parse(event.data)); setOnline(true) }
    source.onerror = () => setOnline(false)
    return () => source.close()
  }, [unlocked])

  const menuKey = live?.menuKey
  useEffect(() => {
    if (!unlocked) return
    api.menu().then(setMenu).catch((err) => notify(err.message))
  }, [unlocked, menuKey, notify])

  const activeCount = live?.active.length ?? 0
  const screen = useMemo(() => {
    if (!boot || !menu || !live) return <div className="loading">Opening the till…</div>
    switch (tab) {
      case 'sell': return <Sell boot={boot} menu={menu} live={live} cart={cart} setCart={setCart} notify={notify} goTill={() => setTab('till')} />
      case 'orders': return <Orders live={live} notify={notify} />
      case 'history': return <History boot={boot} live={live} notify={notify} />
      case 'till': return <Till live={live} notify={notify} />
      case 'menu': return <MenuScreen boot={boot} menu={menu} setMenu={setMenu} notify={notify} />
    }
  }, [boot, menu, live, tab, cart, notify])

  if (!boot) {
    return (
      <div className="gate">
        <img src="/brand/wordmark-white.png" alt="Kennko Coffee" className="gate-logo" />
        <p className="gate-note">{bootError || 'Opening the till…'}</p>
      </div>
    )
  }
  if (!unlocked) return <Gate onUnlock={() => setUnlocked(true)} secureUrl={boot.secureUrl} />

  return (
    <div className="app">
      <nav className="rail" aria-label="Main">
        <img src="/brand/icon.png" alt="Kennko" className="rail-logo" />
        {TABS.map(({ id, label, icon: Icon }) => (
          <button type="button" key={id} className={`rail-btn${tab === id ? ' on' : ''}`} aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}>
            <Icon />
            <span>{label}</span>
            {id === 'orders' && activeCount > 0 ? <b className="badge">{activeCount}</b> : null}
          </button>
        ))}
        <span className="rail-gap" />
        {boot.pinRequired ? (
          <button type="button" className="rail-btn rail-lock" onClick={lock}>
            <LockIcon />
            <span>Lock</span>
          </button>
        ) : null}
      </nav>
      <main className="main">
        {!online ? <div className="banner" role="status">Lost touch with the till computer. Trying again…</div> : null}
        {screen}
      </main>
      {toast ? <div className="toast" role="alert" onClick={() => setToast('')}>{toast}</div> : null}
    </div>
  )
}

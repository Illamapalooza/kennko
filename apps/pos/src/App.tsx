import { useCallback, useEffect, useMemo, useState } from 'react'
import { CatToon } from '@kennko/cats'
import type { Discount, LineInput, Menu, OrderType } from '@kennko/core'
import { ApiError, api, setOnLocked, type Bootstrap, type Live, type Session } from './api.ts'
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
  const [who, setWho] = useState<Session | null>(null)
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

  // The PIN mode and this till's connection change after pairing or a staff refresh; the Gate needs the current one.
  const refreshBoot = useCallback(() => { api.bootstrap().then(setBoot).catch(() => {}) }, [])
  // Locks this screen at once; ending the session on the till is best effort (the wifi may be down).
  const lock = useCallback(() => { setUnlocked(false); setWho(null); refreshBoot(); api.endSession().catch(() => {}) }, [refreshBoot])
  useEffect(() => { setOnLocked(() => { setUnlocked(false); setWho(null); refreshBoot() }) }, [refreshBoot])

  // Start: learn about the shop, then ask the till whether this browser already has a session.
  useEffect(() => {
    let cancelled = false
    const start = async () => {
      try {
        const b = await api.bootstrap()
        let open = b.pinMode === 'off'
        if (!open) {
          try { setWho(await api.session()); open = true } catch (err) {
            if (!(err instanceof ApiError && err.status === 401)) throw err
          }
        }
        if (cancelled) return
        setBoot(b)
        setBootError('')
        setUnlocked(open)
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
  // EventSource retries a dropped connection by itself, but a refused one (a 401) closes it for good: then ask the
  // till about the session. Gone → the PIN screen (call() does that); otherwise open the feed again shortly.
  useEffect(() => {
    if (!unlocked) return
    let source: EventSource | null = null
    let retry: ReturnType<typeof setTimeout> | undefined
    let stopped = false
    const reopen = () => { if (!stopped) retry = setTimeout(open, 2000) }
    function open() {
      source = new EventSource(api.eventsUrl())
      source.onmessage = (event) => { setLive(JSON.parse(event.data)); setOnline(true) }
      source.onerror = () => {
        setOnline(false)
        if (source?.readyState !== EventSource.CLOSED) return
        api.session().then(reopen, (err) => { if (!(err instanceof ApiError && err.status === 401)) reopen() })
      }
    }
    open()
    return () => { stopped = true; clearTimeout(retry); source?.close() }
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
      case 'menu': return <MenuScreen boot={boot} menu={menu} setMenu={setMenu} notify={notify} onDeviceChange={refreshBoot} />
    }
  }, [boot, menu, live, tab, cart, notify, refreshBoot])

  if (!boot) {
    return (
      <div className="gate">
        <img src="/brand/wordmark-blue.png" alt="Kennko Coffee" className="gate-logo" />
        <CatToon coat="calico" pose="nap" className="gate-cat" />
        <p className="gate-note">{bootError || 'Opening the till…'}</p>
      </div>
    )
  }
  if (!unlocked) return <Gate onUnlock={(session) => { setWho(session); setUnlocked(true) }} secureUrl={boot.secureUrl} pinMode={boot.pinMode} onRefresh={refreshBoot} />

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
        {who?.name ? <span className="rail-who">{who.name.trim().split(/\s+/)[0]}</span> : null}
        {boot.pinMode !== 'off' ? (
          <button type="button" className="rail-btn rail-lock" onClick={lock} title={who?.name ? `Signed in as ${who.name}` : undefined}>
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

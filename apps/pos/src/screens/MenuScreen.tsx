import { useState } from 'react'
import { formatPesos, sizeTag, type Menu } from '@kennko/core'
import { api, type Bootstrap, type Live } from '../api.ts'
import { PinPrompt } from '../components/PinPrompt.tsx'
import { Modal } from '../components/Modal.tsx'
import { menuLine } from '../syncText.ts'
import { ConnectTill } from '../components/ConnectTill.tsx'
import { loadProjectorHost, openProjectorWall, saveProjectorHost } from '../app/wall-control.ts'

type Props = {
  boot: Bootstrap
  live: Live
  menu: Menu
  setMenu: (menu: Menu) => void
  notify: (message: string) => void
  /** After pairing: the till's connection and PIN mode may have changed. */
  onDeviceChange: () => void
}

/** Mark a drink sold out for the moment, pull fresh prices from the website, or connect this till to Kennko. */
export function MenuScreen({ boot, live, menu, setMenu, notify, onDeviceChange }: Props) {
  const [busy, setBusy] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [checking, setChecking] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [clearingData, setClearingData] = useState(false)
  const [changingPin, setChangingPin] = useState(false)
  const [curPin, setCurPin] = useState('')
  const [nextPin, setNextPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [pinBusy, setPinBusy] = useState(false)
  const [pinErr, setPinErr] = useState('')
  const [projectorHost, setProjectorHost] = useState(() => loadProjectorHost())
  const [openingWall, setOpeningWall] = useState(false)
  // Per-person mode: the drink waiting for the person's own PIN, so the change is credited to them.
  const [needPin, setNeedPin] = useState<{ itemId: string; available: boolean } | null>(null)
  const device = boot.device

  const toggle = async (itemId: string, available: boolean) => {
    if (boot.pinMode === 'per-person') { setNeedPin({ itemId, available }); return }
    setBusy(itemId)
    try { setMenu(await api.setAvailable(itemId, available)) } catch (err) { notify(err instanceof Error ? err.message : 'That did not work.') } finally { setBusy('') }
  }
  const checkNow = async () => {
    setChecking(true)
    try {
      const result = await api.syncMenu()
      setMenu(result)
      notify(result.notice ?? 'The menu is up to date.')
    } catch (err) { notify(err instanceof Error ? err.message : 'That did not work.') } finally { setChecking(false) }
  }

  return (
    <div className="page">
      <header className="page-head">
        <h1>Menu</h1>
        {boot.syncConfigured ? (
          <button type="button" className="btn btn-primary" disabled={checking} onClick={checkNow}>{checking ? 'Checking…' : 'Check now'}</button>
        ) : boot.websiteConfigured ? (
          <button type="button" className="btn btn-outline" onClick={() => setSyncing(true)}>Update from website</button>
        ) : null}
      </header>
      <p className="muted">
        {menuLine(live.sync, menu)} Switch a drink off when it runs out; it comes back when you switch it on.
      </p>
      <section className="card till-card">
        <h2>This till</h2>
        {device && !device.revoked ? <p>Connected as <b>{device.name}</b></p> : null}
        {!device ? <p className="muted">Not connected to Kennko</p> : null}
        {device?.revoked ? <p className="note-amber" role="status">Disconnected in admin. Connect again with a new code.</p> : null}
        {!device || device.revoked ? (
          <button type="button" className="btn btn-outline" onClick={() => setConnecting(true)}>Connect this till</button>
        ) : null}
        {boot.pinMode === 'per-person' && device && !device.revoked ? (
          <div style={{ marginTop: 10 }}>
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => {
                setCurPin('')
                setNextPin('')
                setConfirmPin('')
                setPinErr('')
                setChangingPin(true)
              }}
            >
              Change my PIN
            </button>
          </div>
        ) : null}
        {boot.host === 'android' ? (
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <button
                type="button"
                className="btn btn-primary"
                disabled={openingWall}
                onClick={async () => {
                  setOpeningWall(true)
                  try {
                    saveProjectorHost(projectorHost)
                    const res = await openProjectorWall(projectorHost)
                    notify(res.message)
                  } finally {
                    setOpeningWall(false)
                  }
                }}
              >
                {openingWall ? 'Opening Wall…' : 'Open Wall on Projector'}
              </button>
              <input
                type="text"
                aria-label="Projector IP"
                value={projectorHost}
                onChange={(e) => setProjectorHost(e.target.value)}
                onBlur={() => saveProjectorHost(projectorHost)}
                placeholder="192.168.1.51"
                style={{ width: 150, padding: '8px 10px', borderRadius: 10, border: '1px solid #cbd5e1', fontSize: 14 }}
              />
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <button type="button" className="btn btn-outline" onClick={() => api.exportBackup().catch((err) => notify(err.message))}>
                Export backup
              </button>
              <button type="button" className="btn btn-outline" style={{ color: '#b91c1c', borderColor: '#fca5a5' }} onClick={() => setClearingData(true)}>
                Clear local test data
              </button>
            </div>
            <p className="muted" style={{ marginTop: 2 }}>Backup has staff PINs (scrambled) and sales. Clearing local data erases shifts &amp; orders on this tablet only (keeps pairing, menu, and staff).</p>
          </div>
        ) : null}
      </section>
      {menu.categories.map((category) => (
        <section className="card" key={category.id}>
          <h2>{category.name}</h2>
          <ul className="toggles">
            {category.items.map((item) => (
              <li key={item.id}>
                <span>
                  {item.name} {item.isBestseller ? <i className="star-inline" aria-label="Bestseller">★</i> : null}
                  <small>{item.prices.map((p) => [sizeTag(p.size), formatPesos(p.priceCentavos)].filter(Boolean).join(' ')).join(' · ')}</small>
                </span>
                <button type="button" role="switch" aria-checked={item.isAvailable} aria-label={`${item.name} available`} className={`switch${item.isAvailable ? ' on' : ''}`} disabled={busy === item.id} onClick={() => toggle(item.id, !item.isAvailable)}>
                  <i />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {needPin ? (
        <PinPrompt
          title="Your PIN"
          hint="Marking a drink sold out is credited to you."
          onClose={() => setNeedPin(null)}
          onSubmit={async (pin) => {
            setMenu(await api.setAvailable(needPin.itemId, needPin.available, pin))
            setNeedPin(null)
          }}
        />
      ) : null}
      {syncing ? (
        <PinPrompt
          title="Manager PIN"
          hint="This replaces the till's drinks and prices with the ones on the website. It needs internet."
          onClose={() => setSyncing(false)}
          onSubmit={async (pin) => {
            setMenu(await api.syncMenu(pin))
            notify('The menu now matches the website.')
            setSyncing(false)
          }}
        />
      ) : null}
      {clearingData ? (
        <PinPrompt
          title="Manager PIN — Clear local data"
          hint="Erases all local shifts, orders, cash moves, and unsent outbox events on this tablet. Keeps pairing, menu, and staff."
          onClose={() => setClearingData(false)}
          onSubmit={async (pin) => {
            await api.clearLocalData(pin)
            setClearingData(false)
            notify('Local POS transactions cleared.')
          }}
        />
      ) : null}
      {changingPin ? (
        <Modal title="Change my PIN" onClose={() => !pinBusy && setChangingPin(false)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault()
              setPinErr('')
              if (!/^\d{6}$/.test(curPin) || !/^\d{6}$/.test(nextPin)) {
                setPinErr('Both PINs must be 6 digits.')
                return
              }
              if (nextPin !== confirmPin) {
                setPinErr('New PIN and confirmation do not match.')
                return
              }
              if (curPin === nextPin) {
                setPinErr('Pick a new PIN different from your current one.')
                return
              }
              setPinBusy(true)
              try {
                await api.changePin(curPin, nextPin)
                setChangingPin(false)
                notify('PIN updated. Use your new PIN next time you log in.')
              } catch (err) {
                setPinErr(err instanceof Error ? err.message : 'Could not change PIN.')
              } finally {
                setPinBusy(false)
              }
            }}
            style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
          >
            <p className="muted" style={{ margin: 0 }}>Enter your current 6-digit PIN and pick a new one you can remember.</p>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontWeight: 700 }}>
              Current PIN
              <input
                type="password"
                inputMode="numeric"
                maxLength={6}
                autoComplete="off"
                value={curPin}
                onChange={(e) => setCurPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="6 digits"
                style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid #cbd5e1', fontSize: 18, letterSpacing: '0.2em' }}
                autoFocus
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontWeight: 700 }}>
              New PIN
              <input
                type="password"
                inputMode="numeric"
                maxLength={6}
                autoComplete="off"
                value={nextPin}
                onChange={(e) => setNextPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="6 digits"
                style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid #cbd5e1', fontSize: 18, letterSpacing: '0.2em' }}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontWeight: 700 }}>
              Confirm new PIN
              <input
                type="password"
                inputMode="numeric"
                maxLength={6}
                autoComplete="off"
                value={confirmPin}
                onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="6 digits"
                style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid #cbd5e1', fontSize: 18, letterSpacing: '0.2em' }}
              />
            </label>
            {pinErr ? <p className="note-amber" role="alert" style={{ margin: 0 }}>{pinErr}</p> : null}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
              <button type="button" className="btn btn-outline" disabled={pinBusy} onClick={() => setChangingPin(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={pinBusy}>{pinBusy ? 'Saving…' : 'Save PIN'}</button>
            </div>
          </form>
        </Modal>
      ) : null}
      {connecting ? (
        <ConnectTill
          onClose={() => setConnecting(false)}
          onConnected={(name) => {
            setConnecting(false)
            notify(`This till is connected as ${name}.`)
            onDeviceChange()
          }}
        />
      ) : null}
    </div>
  )
}

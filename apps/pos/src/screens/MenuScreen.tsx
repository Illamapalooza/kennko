import { useState } from 'react'
import { formatPesos, type Menu } from '@kennko/core'
import { api, type Bootstrap } from '../api.ts'
import { PinPrompt } from '../components/PinPrompt.tsx'
import { ConnectTill } from '../components/ConnectTill.tsx'

type Props = {
  boot: Bootstrap
  menu: Menu
  setMenu: (menu: Menu) => void
  notify: (message: string) => void
  /** After pairing: the till's connection and PIN mode may have changed. */
  onDeviceChange: () => void
}

/** Mark a drink sold out for the moment, pull fresh prices from the website, or connect this till to Kennko. */
export function MenuScreen({ boot, menu, setMenu, notify, onDeviceChange }: Props) {
  const [busy, setBusy] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const device = boot.device

  const toggle = async (itemId: string, available: boolean) => {
    setBusy(itemId)
    try { setMenu(await api.setAvailable(itemId, available)) } catch (err) { notify(err instanceof Error ? err.message : 'That did not work.') } finally { setBusy('') }
  }
  const updated = new Date(menu.updatedAt).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' })

  return (
    <div className="page">
      <header className="page-head">
        <h1>Menu</h1>
        {boot.websiteConfigured ? <button type="button" className="btn btn-outline" onClick={() => setSyncing(true)}>Update from website</button> : null}
      </header>
      <p className="muted">
        {menu.source === 'website' ? `Prices from the website, updated ${updated}.` : 'Using the menu that came with the till.'} Switch a drink off when it runs out; it comes back when you switch it on.
      </p>
      <section className="card till-card">
        <h2>This till</h2>
        {device && !device.revoked ? <p>Connected as <b>{device.name}</b></p> : null}
        {!device ? <p className="muted">Not connected to Kennko</p> : null}
        {device?.revoked ? <p className="note-amber" role="status">Disconnected in admin. Connect again with a new code.</p> : null}
        {!device || device.revoked ? (
          <button type="button" className="btn btn-outline" onClick={() => setConnecting(true)}>Connect this till</button>
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
                  <small>{item.prices.map((p) => `${p.size} ${formatPesos(p.priceCentavos)}`).join(' · ')}</small>
                </span>
                <button type="button" role="switch" aria-checked={item.isAvailable} aria-label={`${item.name} available`} className={`switch${item.isAvailable ? ' on' : ''}`} disabled={busy === item.id} onClick={() => toggle(item.id, !item.isAvailable)}>
                  <i />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
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

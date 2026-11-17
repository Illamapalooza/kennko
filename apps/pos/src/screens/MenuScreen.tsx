import { useState } from 'react'
import { formatPesos, type Menu } from '@kennko/core'
import { api, type Bootstrap } from '../api.ts'
import { PinPrompt } from '../components/PinPrompt.tsx'

type Props = { boot: Bootstrap; menu: Menu; setMenu: (menu: Menu) => void; notify: (message: string) => void }

/** Mark a drink sold out for the moment, or pull fresh prices from the website. */
export function MenuScreen({ boot, menu, setMenu, notify }: Props) {
  const [busy, setBusy] = useState('')
  const [syncing, setSyncing] = useState(false)

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
    </div>
  )
}

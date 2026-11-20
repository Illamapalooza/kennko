# Kennko POS

The till for the shop. It runs on one computer in the shop; tablets open it in a browser over the cafe wifi. Sales are
kept in a local database on that computer, so the till keeps working when the internet is down.

In the shop it runs on the Windows tablet at the counter: see `deploy/windows/README.md` for the one-time setup.

## Start it

From the repo root, once: `npm install`

| When | Command | Opens at |
|---|---|---|
| Building or changing it | `npm run pos` | http://localhost:4466 |
| In the shop | `npm run pos:build`, then `npm run pos:start` | the address it prints for tablets |

Needs Node.js 24 or newer (it uses Node's built-in SQLite).

## What it does

| Screen | For |
|---|---|
| **Sell** | Tap a drink, pick size, ice, add-ons and a note. Dine in or take out, optional name, discount, then charge. |
| **Payment** | Cash with one-tap amounts and change, or GCash with an optional reference. Shows the order number and a printable receipt. |
| **Orders** | The barista queue: Queued → Preparing → Serving → Done. Every tablet follows live. |
| **History** | Every order of a day, its receipt, and voiding (manager PIN). CSV export. |
| **Till** | Open with starting cash, cash in and out, sales so far, expected cash, and closing with a count (manager PIN). |
| **Menu** | Switch a drink off when it runs out. "Update from website" pulls the drinks and prices from the published menu on the Kennko API. |

## The projector wall

Start the wall with `npm run wall:pos` and it follows this till: paid orders walk in as cats, and the wall shows the
queue and calls each order when it is marked Ready. The wall reads `/api/wall/events`, which needs no PIN and carries
only order numbers, first names, drink names and steps. See `wall/README.md`.

## Install it as an app

The till is an installable app (a PWA): it gets its own icon on the home screen, opens full screen, keeps the screen on, and opens even when the till computer is unreachable (it then says it can't reach the till and reconnects by itself). Sales are never stored on the tablet; they always live on the till computer.

Browsers only install apps from an https address, so the till also serves on `https://<address>:4443/` with a certificate it makes for itself. Each device has to be told once to trust it:

1. Start the till with `npm run pos:start` (the secure address is off in `npm run pos`, the development mode).
2. On the tablet, open `http://<till address>:4466/setup` and follow the three steps there.

Things to know:

- **Use one address and keep it.** An installed app belongs to the address it was installed from. Prefer the `.local` name the till prints at startup, or reserve the till computer's IP address in the router. If the address changes, install again from the new one; the tablet does not need to trust the certificate a second time.
- **The certificate is limited to local networks.** The till's certificate authority can only sign for private addresses, `localhost` and `.local` names, so it cannot be used to pose as a website on the internet. Its key is `data/cert/ca.key`; keep it on the till computer.
- **Renewal is automatic.** The till's certificate lasts about 13 months and is remade at startup in its last month. The authority tablets trust lasts 10 years.
- **Updates arrive on the next open.** After `npm run pos:build`, an installed tablet picks up the new screens the next time the app is opened or reloaded.
- **Reload every tablet after updating the till.** A tab left open from before an update keeps the old screens; after the switch to session PINs, an old tab keeps sending its PIN the old way and is refused until it is reloaded and the PIN typed once more.

## Settings

Copy `config.example.json` to `config.json` and edit it. **Change both PINs before real use.**

| Key | Meaning |
|---|---|
| `staffPin` | Opens the till. Typed once per browser; the till then remembers that browser for 16 hours (until Lock, or the browser is closed), even across a restart of the till. The manager PIN opens it too. `""` turns it off. |
| `managerPin` | Asked for voids, cash out, closing the till and updating the menu. If it is `""`, those are blocked: an empty entry is never accepted. |
| `shop` | Name, address, phone and footer printed on receipts. |
| `discounts` | One-tap discounts. `kind` is `percent` (1 to 100) or `amount` (centavos). |
| `api` | `{ "url" }`, the Kennko API the menu update reads from (`GET <url>/v1/menu`). Defaults to the `KENNKO_API_URL` environment variable. An old `website` block is ignored. |
| `securePort` | The https port tablets install the app from. Default `4443`; `0` turns it off. |
| `backupDir` | A second folder for the daily backup, such as a USB stick or a cloud-synced folder. `""` keeps one copy only. |

## Where things live

- `data/pos.db` is every sale, shift and cash movement. It is not in git.
- `data/backups/pos-YYYY-MM-DD.db` is a full copy of it, one file per day, newest 30 kept. See Backups below.
- `data/cert/` is the till's own certificate and the authority that signs it (see Install it as an app). Not in git.
- `data/menu.json` is the menu last pulled from the website. Without it the built-in menu (`packages/core/src/seed-menu.ts`, the same list the website seeds) is used.
- Prices, discounts and order rules come from `packages/core`, shared with the rest of the repo.

## Backups

The till copies its sales database to `data/backups` when it starts, every hour while it runs, and each time the till is closed. Each day has one file, replaced as the day goes on.

That folder is on the same computer as the till, so it does not protect against a lost or broken computer. Set `backupDir` in `config.json` to a USB stick or a cloud-synced folder to get a second copy elsewhere. If that second copy fails, the till keeps working and says so when it starts.

To restore: stop the till, copy the backup you want over `data/pos.db`, delete `data/pos.db-wal` and `data/pos.db-shm` if they exist, and start the till again.

## Tests

`npm test` from the repo root.

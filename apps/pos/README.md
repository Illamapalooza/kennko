# Kennko POS

The till for the shop. It runs on one computer in the shop; tablets open it in a browser over the cafe wifi. Sales are
kept in a local database on that computer, so the till keeps working when the internet is down.

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
| **Menu** | Switch a drink off when it runs out. "Update from website" pulls drinks and prices from the website's menu. |

## Settings

Copy `config.example.json` to `config.json` and edit it. **Change both PINs before real use.**

| Key | Meaning |
|---|---|
| `staffPin` | Asked once per device before the till opens. `""` turns it off. |
| `managerPin` | Asked for voids, cash out, closing the till and updating the menu. |
| `shop` | Name, address, phone and footer printed on receipts. |
| `discounts` | One-tap discounts. `kind` is `percent` (1 to 100) or `amount` (centavos). |
| `website` | `{ "url", "anonKey" }` for the menu update. Defaults to the values in `apps/web/.env.local`. |

## Where things live

- `data/pos.db` is every sale, shift and cash movement. **Back this file up.** It is not in git.
- `data/menu.json` is the menu last pulled from the website. Without it the built-in menu (`packages/core/src/seed-menu.ts`, the same list the website seeds) is used.
- Prices, discounts and order rules come from `packages/core`, shared with the rest of the repo.

## Tests

`npm test` from the repo root.

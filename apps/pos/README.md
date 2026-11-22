# Kennko POS

The till for the shop. Sales are kept in a local SQLite database on the device, so the till keeps working when the
internet is down.

## Kennko POS on the tablet

In the shop it runs as an Android app (`coffee.kennko.pos`) on the Samsung counter tablet, with SQLite inside the app
and a local wall feed (`_kennko-pos._tcp.`) for the projector. See `docs/android-release.md` for building, signing and
go-live.

- Build a debug APK: `npm run pos:apk`
- Build a release APK: `npm run pos:apk -- --release` (needs `~/.kennko/keystore.properties`)
- Backup: **Menu › This till › Export backup** opens the Android share sheet with a snapshot of the database.

## On a Mac, for development

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
| **Menu** | Switch a drink off when it runs out. "Update from website" pulls the drinks and prices from the published menu on the Kennko API. **This till** connects the till to Kennko (see below). |

## The projector wall

Start the wall with `npm run wall:pos` and it follows this till: paid orders walk in as cats, and the wall shows the
queue and calls each order when it is marked Ready. The wall reads `/api/wall/events`, which needs no PIN and carries
only order numbers, first names, drink names and steps, plus the menu's drink names and bestseller stars (never a
price) so the wall needs no menu of its own; `/api/wall/menu` serves the same list. See `wall/README.md`.

## Cats on the wall

Customers who have a Kennko card can bring their own cat (named and dressed on the website) onto the projector wall.
The wall shows a QR code in the bottom-right corner, "Scan to bring your cat in"; scanning it checks them in for 90
minutes, and their cat walks in at the next sync (about 15 seconds).

- **The QR appears once the till has synced at least once.** It needs the check-in secret and the website's clock,
  both from the sync. A till that has never been connected, or was disconnected in admin or forgotten, shows no QR;
  the wall carries on as before.
- **It changes every minute**, on the website's clock (not this computer's), so a photo of the QR stops working after
  a minute or two.
- **Offline:** the till keeps making the QR from what it last synced, even after a restart, but new check-ins wait
  until the internet is back (the phone checks in with the website). Cats already on the wall stay until their visit
  ends, then walk out.
- **What the wall gets:** the QR's link and its squares, and for each visiting cat only a random per-visit key, the
  cat's name, its look and when the visit ends. Never a customer's name, email, card code or points.
- **The secret stays on this computer.** The till keeps it in `data/pos.db` and uses it only to make the code; it is not
  sent to the tablets or the wall, not logged, and not in the daily backup. If it ever leaks, delete the
  `shop_secrets` row in Supabase; the next sync brings a new one.
- On the till, a customer line shows the cat's name first: "Mochi · KC-7F3-…-XAM · 5 of 8 stamps".

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

## Connect the till to Kennko

Connecting lets the till use each person's own PIN, set by the owner in the website's admin.

1. On the website, the owner opens **admin › Tills**, adds this till and gets a 6-digit code (valid 10 minutes).
2. On the till, open **Menu › This till › Connect this till**, type the code, then a manager PIN.

The till then shows "Connected as <name>". It needs internet only for this step; nothing else waits on the website.

### PIN modes

| Mode | When | What opens the till |
|---|---|---|
| **Per person** | The till is connected and the owner has issued a PIN to at least one owner or manager. | Each person's own 6-digit PIN. Voids, cash out, closing and menu update need an owner's or manager's own PIN. The PINs in `config.json` no longer work. |
| **Shared** | Not connected yet, or no owner or manager has a PIN. | `staffPin` and `managerPin` from `config.json`, as before. |
| **Off** | Shared, and `staffPin` is `""`. | Nothing; the till opens straight away. |

So connecting the till changes nothing at the counter until the owner issues PINs in admin. The switch to per-person
signs every tablet out once; each person then types their own PIN, and their first name shows above Lock.

- **PINs are checked on the till.** The till keeps the people allowed in (their name, role and a scrambled copy of
  the PIN, never the PIN itself) in `data/pos.db`, so PINs work with the internet down.
- **The list refreshes** with every sync (when the till starts, about every 15 seconds while it has internet, and right after connecting).
  Someone switched off in admin, or whose PIN was taken away, drops off the list at the next refresh and their
  tablet goes back to the PIN screen.
- **A new PIN works on the next try.** When a typed PIN matches no one, the till asks the website for the list
  straight away (at most once every 30 seconds, waiting at most 2.5 seconds for the answer) and checks the PIN
  again; a slower answer still updates the list for the next try. That counts as one wrong try, not two. So a
  PIN issued a moment ago in admin usually works at the first try; if the till asked in the last 30 seconds, it
  works on a try after that, or at the latest at the next sync. With the internet down the till checks only
  the list it already has.
- **Disconnected in admin.** If the owner disconnects the till in admin › Tills, the till keeps selling with the PINs
  it already has and the Menu screen says "Disconnected in admin". Connect it again with a new code.
- **Forget the connection** with `POST /api/device/forget` (a manager PIN). The PIN list stays, so the same PINs keep
  working. There is no button for it on purpose; disconnecting in admin is the normal way.

## Sync

Once connected, the till and Kennko keep each other up to date. Sales never wait for the internet: the till saves
every sale, shift, cash move and sold-out change on its own computer first, then sends them in the background.

- **What goes to Kennko:** orders and their prep steps, cancellations, shifts opening and closing, cash in and out, and
  sold-out changes. **What comes back:** the published menu and prices, discount presets, shop name, address and phone,
  and the list of people with PINs. The menu applies itself when Kennko has a newer version; no PIN is needed.
- **The outbox** is the `outbox` table in `data/pos.db`. A change leaves it as soon as Kennko answers; if the internet is
  down it simply waits, in order, and is sent when the connection returns. It is in the daily backup.
- **The "Offline" badge** (amber, at the top of every screen) shows only when the till is connected and its last
  try failed: "Offline: 12 sales waiting to send", or "Offline: changes waiting to send" when only other changes wait.
  Selling carries on as normal. If Kennko refuses a request instead, the pill says "Sync problem: ..." with the reason.
- **The clock warning** appears when this computer's clock is more than 5 minutes away from Kennko's: "This
  computer's clock is 7 minutes behind. Sales still work; fix the time in Windows settings so reports line up."
- **One-time copy of old sales:** the first time a connected till runs this version it copies its existing history
  (`pos.db`) to Kennko, 100 rows at a time, and the Menu screen says "Copying sales history to Kennko: 140 left."
  Nothing is lost if it is interrupted; it carries on at the next sync.
- **Check now** (Menu screen, connected tills) runs one sync and waits at most 10 seconds; if Kennko is slow it says
  "Still checking — the menu updates by itself." A till that is not connected keeps **Update from website**, which
  asks for a manager PIN.
- **Sold out:** a connected till sends the change to Kennko. When the menu is pulled, Kennko's sold-out marks replace
  the till's, then the till's own unsent changes are put back on top. In per-person mode the switch asks for the
  person's own PIN ("Your PIN"), so the change is credited to them.
- **Who did it:** voids show "Voided by {first name}" in History and cash moves show "by {first name}" on the Till
  screen, when the person is known (per-person mode). Sales, opening, cash in and sold-out changes are credited to the
  signed-in person; a void, cash out and closing to the manager whose PIN approved it.

## Online orders

Paid orders from the website show up on the Orders board next to counter orders, as **W1, W2...** with an amber
"Online" tag. Counter orders keep their **#** numbers.

- **Only paid orders arrive**, within about 15 seconds of the customer's payment being confirmed. Unpaid, rejected and
  refunded orders never show, and an order cancelled in admin disappears from the board on the next sync.
- **Buttons.** Each ticket has one forward button, and the customer is told at each step, as if admin had pressed it:
  - **Start** (queued → preparing): "W3 is being prepared".
  - **Ready** (pickup) or **Out for delivery** (delivery): "W3 is ready for pickup" (pickup) / "W3 is on its way" (delivery).
  - **Picked up** or **Delivered**: the customer gets "W3 is complete".
- **No Back, and no Void.** The customer has already been told, so a step cannot be undone here. **Cancelling and
  refunding are done in admin**, never on the till. If admin moves an order first, the next sync corrects the ticket.
- **Delivery tickets** also show the address, barangay and the customer's phone. Pickup tickets show no phone. No
  prices or totals are shown on any online ticket.
- **Offline:** orders already pulled stay on the board and the buttons still work. Each step is saved on the till
  and sent to Kennko when the internet returns (it waits in the outbox, in order).
- **Not in History, reports or the cash count.** Online orders live apart from counter sales, so the day summary,
  shift cash, History and the CSV never include them. Online payments are handled by Kennko, not the drawer.
- **Privacy:** the customer's phone and address are deleted from the till when it is disconnected (revoked in admin,
  or forgotten), and orders leave the till once they drop out of the sync.

## Kennko cards

A customer can show their Kennko card (a QR code and a code like `KC-7F3-K9Q-XAM` on their phone). Linking is one scan and
is never required: **Skip** is always one tap, and a sale never waits for it.

- **Add a card:** in the cart tap **Add Kennko card**, scan the QR or type the code. Typing adds `KC-` and groups the
  symbols; a mistyped code says "Check the code" (the last symbol is a check). The till shows their stamps, never a name,
  email, phone or points. It also works afterwards, from **History**, while the till is open.
- **Scanning needs the https address** (`https://<till address>:4443`, see Install it as an app), because browsers only
  open the camera there. If the camera is denied or unavailable the window says so and **typing always works**.
- **Stamp:** after the sale tap **Stamp card** on the paid screen, on the order's ticket in **Orders**, or in **History**.
  One stamp per sale; a sale of only the free drink earns none. Stamps are saved on the till and sent when the internet is back.
- **Free drink** needs the internet: once a card has 8 stamps the cart offers **Make one drink free** (base ₱0, add-ons
  still charged). Charging asks for a manager PIN and claims it with Kennko at once. If that cannot be done nothing is
  saved; charge the drink normally.
- **Offline:** a code typed with no internet shows "Will confirm when back online" (the lookup gives up after 3 seconds).
  The card is still linked and stamped, and Kennko confirms later.
- **Paper cards** are stamped by hand: the till shows "Paper card: stamp their paper card".
- **Online orders** with a Kennko card show **Stamp at pickup** on their ticket.
- Codes are shown as `KC-7F3-…-XAM` everywhere except the add-customer window.

## Settings

Copy `config.example.json` to `config.json` and edit it. **Change both PINs before real use.**

| Key | Meaning |
|---|---|
| `staffPin` | Opens the till in shared mode (see PIN modes). Typed once per browser; the till then remembers that browser for 16 hours (until Lock, or the browser is closed), even across a restart of the till. The manager PIN opens it too. `""` turns it off. Ignored in per-person mode. |
| `managerPin` | Asked for voids, cash out, closing the till, updating the menu and connecting the till, in shared or off mode. If it is `""`, those are blocked: an empty entry is never accepted. Ignored in per-person mode. |
| `shop` | Name, address, phone and footer printed on receipts. |
| `discounts` | One-tap discounts. `kind` is `percent` (1 to 100) or `amount` (centavos). |
| `api` | `{ "url" }`, the Kennko API the menu update reads from (`GET <url>/v1/menu`) and the till connects to (`/v1/devices/*`). Defaults to the `KENNKO_API_URL` environment variable. An old `website` block is ignored. |
| `securePort` | The https port tablets install the app from. Default `4443`; `0` turns it off. |
| `backupDir` | A second folder for the daily backup, such as a USB stick or a cloud-synced folder. `""` keeps one copy only. |

## Where things live

- `data/pos.db` is every sale, shift and cash movement, the tablets' sessions and the cached staff list. It is not in git.
- `data/device.json` is this till's connection to Kennko: its name and its token for the API. The token works like a
  password, so the file is readable only by the user the till runs as. Not in git. Deleting it is the same as
  forgetting the connection.
- `data/backups/pos-YYYY-MM-DD.db` is a full copy of it, one file per day, newest 30 kept. See Backups below.
- `data/cert/` is the till's own certificate and the authority that signs it (see Install it as an app). Not in git.
- `data/menu.json` is the menu last pulled from the website. Without it the built-in menu (`packages/core/src/seed-menu.ts`, the same list the website seeds) is used.
- Prices, discounts and order rules come from `packages/core`, shared with the rest of the repo.

**`data/` holds secrets.** `device.json` has the till's token for the API, and `pos.db` (and so every backup copy,
including the one in `backupDir`) has the cached staff list with each person's scrambled PIN. Keep backups private:
a USB stick in the drawer or a cloud folder only the owner can open, never a shared folder.

## Backups

The till copies its sales database to `data/backups` when it starts, every hour while it runs, and each time the till is closed. Each day has one file, replaced as the day goes on.

That folder is on the same computer as the till, so it does not protect against a lost or broken computer. Set `backupDir` in `config.json` to a USB stick or a cloud-synced folder to get a second copy elsewhere. If that second copy fails, the till keeps working and says so when it starts.

To restore: stop the till, copy the backup you want over `data/pos.db`, delete `data/pos.db-wal` and `data/pos.db-shm` if they exist, and start the till again.

## Tests

`npm test` from the repo root.

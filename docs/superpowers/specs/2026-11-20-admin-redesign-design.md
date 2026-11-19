# Kennko admin redesign: see a lot, edit in place, navigate clearly

**Status:** approved by Julius, 2026-11-20 (approach A). Builds on Backend Plan 1 (menu variants and published snapshots,
live since 2026-11-20).

## Why

Julius: "I can edit and see a lot of the items easily and navigate clearly." Today the admin opens straight into a
long menu list, edits need a separate page per drink, publishing is a button that is easy to forget, food options
cannot be edited, and orders are one long list.

## Goals

1. **See a lot at once:** the whole menu on one dense, scannable screen, grouped by category.
2. **Edit in place:** prices per size, sold out and bestseller change right in the table.
3. **Never forget to publish:** a sticky bar shows when the published menu is behind the edits.
4. **Navigate clearly:** a persistent navigation with four places: Overview, Orders, Menu, Staff.
5. Work on a laptop (dense table) and on a phone (stacked rows, bottom tab bar).

## Non-goals

- Order management changes beyond tabs and counts (verification flow is unchanged).
- Categories and option-group CRUD (renaming, reordering categories, creating groups). Out of scope; attaching
  existing groups to an item is in scope.
- Reports and the till's views (later backend plans).
- Bulk import or CSV.

## Approaches considered

| | Approach | Verdict |
|---|---|---|
| **A** | **Spreadsheet-style table with inline edits and a side drawer, sidebar navigation, Overview, order tabs** | **Chosen** |
| B | Card grid with pop-up editors | Shows far fewer items per screen |
| C | Restyle the current pages | Fixes neither density nor navigation |

## Behaviour

- **Drafts and publishing** *(Claude's call)*. Every owner edit to the menu (prices, names, descriptions,
  bestseller, archive, options, photos) changes the menu tables only. The **published** menu, which the website and
  till sell from, changes only when the owner presses **Publish**. A sticky bar on every admin page shows
  "Unpublished changes · Publish" whenever the tables differ from the latest snapshot. The per-save auto-publish
  added in Plan 1 Task 9 is removed, so editing ten prices makes one version, not ten.
- **Sold out is instant**, as today: the switch applies to the website and till immediately with no publish
  (availability is overlaid live by the API).
- **Who can do what** is unchanged: baristas toggle sold out; owners edit everything and publish.

## Screens

### Shell
```
┌──────────────┬───────────────────────────────────────────────┐
│ KENNKO admin │  Menu                     [search…] [+ Add]   │
│              │  [All] [Premium] [Barista's] [Sweet] [Matcha] [Food]
│ ▸ Overview   │  ─────────────────────────────────────────────│
│ ▸ Orders (2) │  table…                                       │
│ ▸ Menu       │                                               │
│ ▸ Staff      │                                               │
│              │ ┌───────────────────────────────────────────┐ │
│ Julius ·owner│ │ 3 unpublished changes        [ Publish ]  │ │
│ Sign out     │ └───────────────────────────────────────────┘ │
└──────────────┴───────────────────────────────────────────────┘
```
- Left sidebar on screens 920px and wider: wordmark, the four places with counts (orders needing a GCash check), the
  signed-in name and role, sign out. Below 920px it becomes a bottom tab bar with the same four places.
- Plain core admin style (`brand/DESIGN.md`): blue and white, Nunito, tokens, no stickers; dense but with 44px tap
  targets on touch.

### Overview (new home, `/admin`)
Three tiles that link where the work is: **Orders to check** (awaiting GCash verification), **Sold out now** (items,
sizes, options), **Menu** (published version and when, plus "unpublished changes" if any). A short list of the
five most recent orders.

### Menu (`/admin/menu`)
```
 Item               M      L      XL     HOT    ★  Sold out   
 Americano        [ 80 ] [ 90 ] [100 ] [ 95 ]  ☆  ( )        ›
 Spanish Latte    [105 ] [125 ] [135 ] [135 ]  ★  ( )        ›
 Cookies          [ 60 single price        ]  ☆  ( )        ›
```
- One table per category under sticky category headers; search filters by name as you type; chips filter by
  category. Archived items are hidden behind a "Show archived" toggle.
- Price cells are inputs: type a new price, press Enter or leave the cell to save; the row shows "Saved" or the
  error inline. Blank means "not offered" (archives that size). Food rows show one "Single price" cell.
- Bestseller is a star toggle; sold out is a switch (instant, see above).
- `›` (or clicking the name) opens the **side drawer**: name, category, description, photo, bestseller, option groups
  attached (checkboxes over the existing groups), archive. Saving the drawer keeps you on the table.
- **+ Add** opens the drawer empty.
- Baristas see the same table read-only except the sold-out switches.

### Orders (`/admin/orders`)
Tabs: **Needs checking** (awaiting verification), **In progress** (confirmed, preparing, ready, out for delivery),
**Done** (completed, rejected, cancelled; last 7 days). The existing order cards and actions stay as they are inside
each tab. The tab count shows in the sidebar.

### Staff (`/admin/staff`)
Same features, restyled as a table matching the menu.

## API addition

`GET /v1/menu/status` (staff): `{ publishedVersion, publishedAt, hasUnpublishedChanges }`, computed by comparing
`hashBody(buildSnapshotBody())` with the latest snapshot's hash. The publish bar and Overview read it.

## Left to the builder

- Component structure, debounce/optimistic details for inline saves (must never lose a typed price silently).
- Exact counts' refresh strategy (server render on navigation is enough).
- Tests: price cell parse/save errors, draft-vs-published status, permission (barista cannot edit prices),
  sold-out instant, tabs filter correctly.

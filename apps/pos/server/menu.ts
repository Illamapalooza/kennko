import fs from 'node:fs'
import path from 'node:path'
import { SIZE_ORDER, liveDrinkMenu, type Menu, type MenuSnapshot } from '@kennko/core'
// The same list the website's seeder loads, so the till and the website start from one menu.
import { SEED_CATEGORIES, SEED_MODIFIER_GROUPS } from '@kennko/core/seed-menu'

const slug = (text: string) => text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

/** The menu that ships with the till, used until a copy is pulled from the website. */
export function builtInMenu(now: number): Menu {
  return {
    source: 'built-in',
    updatedAt: now,
    categories: SEED_CATEGORIES.map((category) => ({
      id: slug(category.name),
      name: category.name,
      items: category.items.map((item) => ({
        id: slug(`${category.name}-${item.name}`),
        name: item.name,
        isBestseller: item.isBestseller,
        isAvailable: true,
        prices: SIZE_ORDER.filter((size) => item.prices[size] !== null).map((size) => ({ size, priceCentavos: item.prices[size] as number })),
      })),
    })),
    modifierGroups: SEED_MODIFIER_GROUPS.map((group) => ({
      id: slug(group.name),
      name: group.name,
      isMultiSelect: group.isMultiSelect,
      modifiers: group.modifiers.map((m) => ({ id: slug(`${group.name}-${m.name}`), name: m.name, priceCentavos: m.priceCentavos, isAvailable: true })),
    })),
  }
}

function isMenu(raw: any): raw is Menu {
  return Boolean(raw) && Array.isArray(raw.categories) && Array.isArray(raw.modifierGroups)
    && raw.categories.every((c: any) => typeof c?.id === 'string' && Array.isArray(c.items)
      && c.items.every((i: any) => typeof i?.id === 'string' && typeof i.name === 'string' && Array.isArray(i.prices)))
}

export function loadMenu(dataDir: string, now: number): Menu {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(dataDir, 'menu.json'), 'utf8'))
    if (isMenu(raw)) return raw
    console.warn('The saved menu could not be understood; using the built-in menu.')
  } catch (err: any) {
    if (err.code !== 'ENOENT') console.warn(`Could not read the saved menu (${err.message}); using the built-in menu.`)
  }
  return builtInMenu(now)
}

export function saveMenu(dataDir: string, menu: Menu): void {
  fs.mkdirSync(dataDir, { recursive: true })
  const file = path.join(dataDir, 'menu.json')
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(menu, null, 2))
  fs.renameSync(`${file}.tmp`, file)
}

/** Reads the published menu from the Kennko API. Needs internet; everything else on the till does not. */
export async function fetchApiMenu(apiUrl: string, now: number): Promise<Menu> {
  if (!apiUrl) throw new Error('The website connection is not set up on this computer.')
  const empty = () => new Error('The website menu came back empty, so the current menu was kept.')
  let res: Response
  try {
    res = await fetch(`${apiUrl.replace(/\/$/, '')}/v1/menu`, { signal: AbortSignal.timeout(15000) })
  } catch {
    throw new Error('Could not reach the website. Check the internet and try again.')
  }
  if (res.status === 404) throw empty()
  if (!res.ok) throw new Error(`The website refused the menu request (${res.status}).`)
  let snapshot: MenuSnapshot
  try { snapshot = (await res.json()) as MenuSnapshot } catch { throw new Error('Could not reach the website. Check the internet and try again.') }
  const menu = liveDrinkMenu(snapshot, now)
  if (menu.categories.length === 0) throw empty()
  return menu
}

const SNAPSHOT_FILE = 'menu-snapshot.json'
const isText = (v: unknown) => typeof v === 'string'
const isList = (v: unknown, each: (x: any) => boolean) => Array.isArray(v) && v.every(each)

/** True when `raw` has the shape of a published menu snapshot, deep enough that the till can build its menu from it. */
export function isMenuSnapshot(raw: any): raw is MenuSnapshot {
  return Boolean(raw) && Number.isInteger(raw.version) && raw.version >= 1 && isText(raw.publishedAt)
    && isList(raw.categories, (c) => Boolean(c) && isText(c.id) && isText(c.name) && (c.kind === 'drink' || c.kind === 'food')
      && isList(c.items, (i) => Boolean(i) && isText(i.id) && isText(i.name) && typeof i.isAvailable === 'boolean'
        && isList(i.optionGroupIds, isText)
        && isList(i.variants, (v) => Boolean(v) && isText(v.id) && isText(v.code) && Number.isInteger(v.priceCentavos) && typeof v.isAvailable === 'boolean')))
    && isList(raw.optionGroups, (g) => Boolean(g) && isText(g.id) && isText(g.name) && Number.isInteger(g.maxSelect)
      && isList(g.options, (o) => Boolean(o) && isText(o.id) && isText(o.name) && Number.isInteger(o.priceCentavos) && typeof o.isAvailable === 'boolean'))
    && isList(raw.discountPresets, (d) => Boolean(d) && isText(d.id) && isText(d.label) && (d.kind === 'percent' || d.kind === 'amount') && typeof d.value === 'number')
}

/** The raw snapshot pulled from the website, kept as data/menu-snapshot.json (tmp + rename, so never half a file). */
export function saveSnapshot(dataDir: string, s: MenuSnapshot): void {
  fs.mkdirSync(dataDir, { recursive: true })
  const file = path.join(dataDir, SNAPSHOT_FILE)
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(s, null, 2))
  fs.renameSync(`${file}.tmp`, file)
}

/** The saved snapshot, or null when there is none or it is not a snapshot. */
export function loadSnapshot(dataDir: string): MenuSnapshot | null {
  let raw: unknown
  try { raw = JSON.parse(fs.readFileSync(path.join(dataDir, SNAPSHOT_FILE), 'utf8')) } catch (err: any) {
    if (err.code !== 'ENOENT') console.warn(`  data/${SNAPSHOT_FILE} could not be read (${err.message}); ignoring it.`)
    return null
  }
  if (isMenuSnapshot(raw)) return raw
  console.warn(`  data/${SNAPSHOT_FILE} is not a menu snapshot; ignoring it.`)
  return null
}

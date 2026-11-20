import fs from 'node:fs'
import path from 'node:path'
import { SIZE_ORDER, liveDrinkMenu, type Discount, type Menu, type MenuSnapshot } from '@kennko/core'
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

/**
 * Reads the published menu snapshot from the Kennko API, as it came (Ruling 11: saved raw, built into the till's menu
 * by `tillMenu`). For an unpaired till's manual pull; a paired till gets the menu with its sync. Needs internet;
 * everything else on the till does not.
 */
export async function fetchApiMenu(apiUrl: string, now: number): Promise<MenuSnapshot> {
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
  let raw: unknown
  try { raw = await res.json() } catch { throw new Error('Could not reach the website. Check the internet and try again.') }
  if (!isMenuSnapshot(raw)) throw new Error('The website gave a menu the till could not understand, so the current menu was kept.')
  if (liveDrinkMenu(raw, now).categories.length === 0) throw empty()
  return raw
}

/**
 * The menu the till sells from. With a pulled snapshot: a copy with every item, variant and option in `soldOut` marked
 * unavailable, built with `liveDrinkMenu` (so it carries `version`; a sold-out variant loses its price). Without one:
 * `fallback` (the old menu.json or the built-in menu) with item-level marks.
 */
export function tillMenu(snapshot: MenuSnapshot | null, fallback: Menu, soldOut: Set<string>, now: number): Menu {
  if (!snapshot) {
    return {
      ...fallback,
      categories: fallback.categories.map((c) => ({ ...c, items: c.items.map((i) => (soldOut.has(i.id) ? { ...i, isAvailable: false } : i)) })),
    }
  }
  const off = <T extends { id: string; isAvailable: boolean }>(x: T): T => (soldOut.has(x.id) ? { ...x, isAvailable: false } : x)
  return liveDrinkMenu({
    ...snapshot,
    categories: snapshot.categories.map((c) => ({ ...c, items: c.items.map((i) => ({ ...off(i), variants: i.variants.map(off) })) })),
    optionGroups: snapshot.optionGroups.map((g) => ({ ...g, options: g.options.map(off) })),
  }, now)
}

const warnedPresets = new Set<string>()

/**
 * The discounts the till offers (Ruling 13): the snapshot's presets when one is loaded and has any the till can record,
 * else config.json's. Like config presets, a non-whole value is left out (Ruling P4-4) and logged once.
 */
export function tillDiscounts(snapshot: MenuSnapshot | null, configDiscounts: Discount[]): Discount[] {
  const presets = (snapshot?.discountPresets ?? []).filter((d) => {
    if (Number.isInteger(d.value) && d.value > 0) return true
    const key = `${d.id}:${d.value}`
    if (!warnedPresets.has(key)) {
      warnedPresets.add(key)
      console.warn(`  Discount "${d.label}" (${d.value}) from the website is not a whole number above 0, so the till leaves it out.`)
    }
    return false
  })
  return presets.length > 0 ? presets.map((d) => ({ label: d.label, kind: d.kind, value: d.value })) : configDiscounts
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

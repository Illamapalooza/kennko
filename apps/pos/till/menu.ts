import { FOOD_SIZE, SIZE_ORDER, liveDrinkMenu, liveTillMenu, type Discount, type Menu, type MenuSnapshot } from '@kennko/core'
// The same list the website's seeder loads, so the till and the website start from one menu.
import { SEED_CATEGORIES, SEED_FOOD, SEED_MODIFIER_GROUPS } from '@kennko/core/seed-menu'
import type { TillFiles } from './files.ts'

const slug = (text: string) => text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

/** The menu that ships with the till, used until a copy is pulled from the website. */
export function builtInMenu(now: number): Menu {
  const drinkGroupIds = SEED_MODIFIER_GROUPS.map((group) => slug(group.name))
  return {
    source: 'built-in',
    updatedAt: now,
    categories: [
      ...SEED_CATEGORIES.map((category) => ({
        id: slug(category.name),
        name: category.name,
        items: category.items.map((item) => ({
          id: slug(`${category.name}-${item.name}`),
          name: item.name,
          isBestseller: item.isBestseller,
          isAvailable: true,
          prices: SIZE_ORDER.filter((size) => item.prices[size] !== null).map((size) => ({ size, priceCentavos: item.prices[size] as number })),
          modifierGroupIds: drinkGroupIds,
        })),
      })),
      {
        id: 'food',
        name: 'Food',
        kind: 'food' as const,
        items: SEED_FOOD.map((food) => ({
          id: slug(`food-${food.name}`),
          name: food.name,
          isBestseller: false,
          isAvailable: true,
          prices: [{ size: FOOD_SIZE, priceCentavos: food.priceCentavos }],
          modifierGroupIds: food.flavours ? [slug(food.flavours.groupName)] : [],
        })),
      },
    ],
    modifierGroups: [
      ...SEED_MODIFIER_GROUPS.map((group) => ({
        id: slug(group.name),
        name: group.name,
        isMultiSelect: group.isMultiSelect,
        modifiers: group.modifiers.map((m) => ({ id: slug(`${group.name}-${m.name}`), name: m.name, priceCentavos: m.priceCentavos, isAvailable: true })),
      })),
      ...SEED_FOOD.flatMap((food) => (food.flavours ? [{
        id: slug(food.flavours.groupName),
        name: food.flavours.groupName,
        isMultiSelect: false,
        minSelect: 1,
        modifiers: food.flavours.options.map((name) => ({ id: slug(`${food.flavours!.groupName}-${name}`), name, priceCentavos: 0, isAvailable: true })),
      }] : [])),
    ],
  }
}

function isMenu(raw: any): raw is Menu {
  return Boolean(raw) && Array.isArray(raw.categories) && Array.isArray(raw.modifierGroups)
    && raw.categories.every((c: any) => typeof c?.id === 'string' && Array.isArray(c.items)
      && c.items.every((i: any) => typeof i?.id === 'string' && typeof i.name === 'string' && Array.isArray(i.prices)))
}

export function loadMenu(files: TillFiles, now: number): Menu {
  try {
    const text = files.read('menu.json')
    if (text === null) return builtInMenu(now)
    const raw = JSON.parse(text)
    if (isMenu(raw)) return raw
    console.warn('The saved menu could not be understood; using the built-in menu.')
  } catch (err: any) {
    console.warn(`Could not read the saved menu (${err.message}); using the built-in menu.`)
  }
  return builtInMenu(now)
}

/**
 * Reads the published menu snapshot from the Kennko API, as it came (Ruling 11: saved raw, built into the till's menu
 * by `tillMenu`). For an unpaired till's manual pull; a paired till gets the menu with its sync. Needs internet;
 * everything else on the till does not.
 */
export async function fetchApiMenu(apiUrl: string, now: number, fetchFn: typeof fetch = fetch): Promise<MenuSnapshot> {
  if (!apiUrl) throw new Error('The website connection is not set up on this computer.')
  const empty = () => new Error('The website menu came back empty, so the current menu was kept.')
  let res: Response
  try {
    res = await fetchFn(`${apiUrl.replace(/\/$/, '')}/v1/menu`, { signal: AbortSignal.timeout(15000) })
  } catch {
    throw new Error('Could not reach the website. Check the internet and try again.')
  }
  if (res.status === 404) throw empty()
  if (!res.ok) throw new Error(`The website refused the menu request (${res.status}).`)
  let raw: unknown
  try { raw = await res.json() } catch { throw new Error('Could not reach the website. Check the internet and try again.') }
  if (!isMenuSnapshot(raw)) throw new Error('The website gave a menu the till could not understand, so the current menu was kept.')
  // A menu with no drinks is a broken publish, even if food is left: keep the current one.
  if (liveDrinkMenu(raw, now).categories.length === 0) throw empty()
  return raw
}

/**
 * A `GET /v1/menu` body for an unpaired till's manual pull: the snapshot with every item, variant and option made
 * available, plus the ids that were unavailable. The till saves the first and adds the ids to its own `sold_out`, so the
 * website's sold-out marks are not baked into the saved menu where staff could never undo them.
 */
export function splitSoldOut(snap: MenuSnapshot): { snapshot: MenuSnapshot; soldOut: string[] } {
  const soldOut: string[] = []
  const on = <T extends { id: string; isAvailable: boolean }>(x: T): T => {
    if (!x.isAvailable) soldOut.push(x.id)
    return { ...x, isAvailable: true }
  }
  const snapshot: MenuSnapshot = {
    ...snap,
    categories: snap.categories.map((c) => ({ ...c, items: c.items.map((i) => ({ ...on(i), variants: i.variants.map(on) })) })),
    optionGroups: snap.optionGroups.map((g) => ({ ...g, options: g.options.map(on) })),
  }
  return { snapshot, soldOut }
}

/**
 * The menu the till sells from. With a pulled snapshot: a copy with every item, variant and option in `soldOut` marked
 * unavailable, built with `liveTillMenu` (drinks and food; it carries `version`; a sold-out variant loses its price). Without one:
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
  return liveTillMenu({
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
export function saveSnapshot(files: TillFiles, s: MenuSnapshot): void {
  files.write(SNAPSHOT_FILE, JSON.stringify(s, null, 2))
}

/** The saved snapshot, or null when there is none or it is not a snapshot. */
export function loadSnapshot(files: TillFiles): MenuSnapshot | null {
  let raw: unknown
  try {
    const text = files.read(SNAPSHOT_FILE)
    if (text === null) return null
    raw = JSON.parse(text)
  } catch (err: any) {
    console.warn(`  data/${SNAPSHOT_FILE} could not be read (${err.message}); ignoring it.`)
    return null
  }
  if (isMenuSnapshot(raw)) return raw
  console.warn(`  data/${SNAPSHOT_FILE} is not a menu snapshot; ignoring it.`)
  return null
}

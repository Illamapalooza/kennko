import fs from 'node:fs'
import path from 'node:path'
import { SIZE_ORDER, type DrinkSize, type Menu } from '@kennko/core'
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

type Rows = { categories: any[]; groups: any[] }

/** Turns the website's database rows into the till's menu. Pure, so it can be tested without a network. */
export function mapWebsiteMenu({ categories, groups }: Rows, now: number): Menu {
  const bySort = (a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0)
  return {
    source: 'website',
    updatedAt: now,
    categories: [...categories].sort(bySort).map((c) => ({
      id: String(c.id),
      name: String(c.name),
      items: [...(c.menu_items ?? [])].sort(bySort).map((i: any) => ({
        id: String(i.id),
        name: String(i.name),
        isBestseller: Boolean(i.is_bestseller),
        isAvailable: Boolean(i.is_available),
        prices: [...(i.menu_item_prices ?? [])]
          .filter((p: any) => SIZE_ORDER.includes(p.size) && Number.isInteger(p.price_centavos))
          .sort((a: any, b: any) => SIZE_ORDER.indexOf(a.size) - SIZE_ORDER.indexOf(b.size))
          .map((p: any) => ({ size: p.size as DrinkSize, priceCentavos: p.price_centavos as number })),
      })).filter((i: any) => i.prices.length > 0),
    })).filter((c) => c.items.length > 0),
    modifierGroups: [...groups].sort(bySort).map((g) => ({
      id: String(g.id),
      name: String(g.name),
      isMultiSelect: Boolean(g.is_multi_select),
      modifiers: [...(g.modifiers ?? [])].sort(bySort).map((m: any) => ({
        id: String(m.id), name: String(m.name), priceCentavos: Number(m.price_centavos), isAvailable: m.is_available !== false,
      })),
    })).filter((g) => g.modifiers.length > 0),
  }
}

/** Reads the public menu the website shows. Needs internet; everything else on the till does not. */
export async function fetchWebsiteMenu(website: { url: string; anonKey: string }, now: number): Promise<Menu> {
  if (!website.url || !website.anonKey) throw new Error('The website connection is not set up on this computer.')
  const get = async (query: string) => {
    let res: Response
    try {
      res = await fetch(`${website.url.replace(/\/$/, '')}/rest/v1/${query}`, {
        headers: { apikey: website.anonKey, authorization: `Bearer ${website.anonKey}` },
        signal: AbortSignal.timeout(15000),
      })
    } catch {
      throw new Error('Could not reach the website. Check the internet and try again.')
    }
    if (!res.ok) throw new Error(`The website refused the menu request (${res.status}).`)
    return res.json() as Promise<any[]>
  }
  const [categories, groups] = await Promise.all([
    get('menu_categories?select=id,name,sort_order,menu_items(id,name,is_bestseller,is_available,sort_order,menu_item_prices(size,price_centavos))&is_active=eq.true'),
    get('modifier_groups?select=id,name,is_multi_select,sort_order,modifiers(id,name,price_centavos,is_available,sort_order)'),
  ])
  const menu = mapWebsiteMenu({ categories, groups }, now)
  if (menu.categories.length === 0) throw new Error('The website menu came back empty, so the current menu was kept.')
  return menu
}

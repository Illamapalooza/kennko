'use server'

import { revalidatePath } from 'next/cache'
import { getServerClient } from '@/lib/supabase/server'
import { requireStaff, requireOwner, getCurrentStaff } from '@/lib/auth/session'
import { validateImage } from '@/lib/images/validate'
import { publishMenu } from '@/lib/menu/publish'
import { drinkGroupLinksFor, type DrinkGroupLinkRow } from './drink-groups'
import { VARIANT_META, parsePriceInput, parseVariantPrices, variantCodesFor, type CategoryKind } from './format'
import type { AdminMenu, VariantCode } from '@/lib/menu/types'

const IMAGE_BUCKET = 'menu-images'

export async function publishMenuNow(): Promise<{ ok: true; version: number } | { ok: false; message: string }> {
  await requireOwner()
  const result = await publishMenu()
  if (result.ok) {
    revalidatePath('/')
    revalidatePath('/admin', 'layout')
  }
  return result
}

export async function getAdminMenu(): Promise<AdminMenu> {
  await requireStaff()
  const db = await getServerClient()

  const [categoriesResult, groupsResult] = await Promise.all([
    db
      .from('menu_categories')
      .select(
        `id, name, kind, sort_order,
         menu_items ( id, category_id, name, description, image_path, is_bestseller,
                      is_available, is_archived, sort_order,
                      menu_variants ( code, price_centavos, is_archived, is_available, sort_order ),
                      item_option_groups ( group_id, sort_order ) )`,
      )
      .order('sort_order'),
    db.from('option_groups').select('id, name, min_select, max_select, sort_order').order('sort_order'),
  ])

  if (categoriesResult.error) throw new Error(`Failed to load menu: ${categoriesResult.error.message}`)
  if (groupsResult.error) throw new Error(`Failed to load add-on groups: ${groupsResult.error.message}`)

  type Row = {
    id: string
    name: string
    kind: 'drink' | 'food'
    menu_items: {
      id: string
      category_id: string
      name: string
      description: string | null
      image_path: string | null
      is_bestseller: boolean
      is_available: boolean
      is_archived: boolean
      sort_order: number
      menu_variants: { code: VariantCode; price_centavos: number; is_archived: boolean; is_available: boolean; sort_order: number }[]
      item_option_groups: { group_id: string; sort_order: number }[]
    }[]
  }

  return {
    categories: ((categoriesResult.data ?? []) as unknown as Row[]).map((category) => ({
      id: category.id,
      name: category.name,
      kind: category.kind,
      items: [...category.menu_items]
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((item) => ({
          id: item.id,
          name: item.name,
          description: item.description,
          imagePath: item.image_path,
          isBestseller: item.is_bestseller,
          isAvailable: item.is_available,
          isArchived: item.is_archived,
          categoryId: item.category_id,
          prices: [...item.menu_variants]
            .sort((a, b) => a.sort_order - b.sort_order)
            .map((v) => ({ code: v.code, priceCentavos: v.price_centavos, isArchived: v.is_archived, isAvailable: v.is_available })),
          optionGroupIds: [...item.item_option_groups]
            .sort((a, b) => a.sort_order - b.sort_order)
            .map((g) => g.group_id),
        })),
    })),
    optionGroups: (groupsResult.data ?? []).map((g) => ({
      id: g.id,
      name: g.name,
      minSelect: g.min_select,
      maxSelect: g.max_select,
    })),
  }
}

export async function setAvailability(itemId: string, isAvailable: boolean) {
  await requireStaff()
  const db = await getServerClient()

  const { error } = await db
    .from('menu_items')
    .update({ is_available: isAvailable })
    .eq('id', itemId)

  if (error) throw new Error(`Could not update availability: ${error.message}`)

  revalidatePath('/admin/menu')
  revalidatePath('/')
  revalidatePath('/admin', 'layout')
}

/** Saves an item as a draft: no publish, no redirect. New items need a price; existing items keep theirs (prices are edited in the table). */
export async function saveMenuItemDraft(
  formData: FormData,
): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  const staff = await getCurrentStaff()
  if (staff?.role !== 'owner') return { ok: false, message: 'Only the owner can edit menu items.' }

  const id = String(formData.get('id') ?? '') || null
  const name = String(formData.get('name') ?? '').trim()
  const categoryId = String(formData.get('category_id') ?? '')
  const description = String(formData.get('description') ?? '').trim() || null
  const isBestseller = formData.get('is_bestseller') === 'on'

  if (!name) return { ok: false, message: 'Enter a name' }
  if (!id && !categoryId) return { ok: false, message: 'Choose a category' }

  const db = await getServerClient()
  // An existing item keeps its stored category: the category is not editable after creation.
  const { data: category, error: categoryError } = id
    ? await db.from('menu_items').select('menu_categories!inner ( kind )').eq('id', id).maybeSingle()
    : await db.from('menu_categories').select('kind').eq('id', categoryId).single()
  if (categoryError || !category) return { ok: false, message: id ? 'Item not found.' : 'Choose a category' }
  const rawKind = (category as unknown as { kind?: CategoryKind; menu_categories?: { kind: CategoryKind } | { kind: CategoryKind }[] })
  const kind = (rawKind.kind ??
    (Array.isArray(rawKind.menu_categories) ? rawKind.menu_categories[0] : rawKind.menu_categories)?.kind) as CategoryKind

  let prices: ReturnType<typeof parseVariantPrices> | null = null
  if (!id) {
    try {
      prices = parseVariantPrices(formData, kind)
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : 'Enter a valid price' }
    }
    if (Object.values(prices).every((v) => v === null)) {
      return { ok: false, message: kind === 'food' ? 'Set a price' : 'Set a price for at least one size' }
    }
  }

  const row = {
    name,
    description,
    is_bestseller: isBestseller,
    updated_at: new Date().toISOString(),
  }

  const { data: saved, error } = id
    ? await db.from('menu_items').update(row).eq('id', id).select('id').single()
    : await db.from('menu_items').insert({ ...row, category_id: categoryId }).select('id').single()
  if (error || !saved) return { ok: false, message: `Could not save the item: ${error?.message ?? 'not found'}` }

  if (!id && prices) {
    // A new drink gets the drink add-on groups, or checkout would refuse every add-on on it. Food gets none.
    if (kind === 'drink') {
      const { data: linked, error: linkedError } = await db
        .from('item_option_groups')
        .select('group_id, sort_order, menu_items!inner ( is_archived, menu_categories!inner ( kind ) )')
      if (linkedError) return { ok: false, message: `Could not load the add-on groups: ${linkedError.message}` }
      const links = drinkGroupLinksFor(saved.id, (linked ?? []) as unknown as DrinkGroupLinkRow[])
      if (links.length > 0) {
        const { error: linkError } = await db.from('item_option_groups').insert(links)
        if (linkError) return { ok: false, message: `Could not attach the add-ons: ${linkError.message}` }
      }
    }

    const toUpsert = variantCodesFor(kind)
      .filter((code) => prices[code] !== null)
      .map((code) => ({
        item_id: saved.id,
        code,
        label: VARIANT_META[code].label,
        price_centavos: prices[code] as number,
        temperature: VARIANT_META[code].temperature,
        sort_order: VARIANT_META[code].sortOrder,
        is_archived: false,
        updated_at: new Date().toISOString(),
      }))
    const { error: upsertError } = await db.from('menu_variants').upsert(toUpsert, { onConflict: 'item_id,code' })
    if (upsertError) return { ok: false, message: `Could not save prices: ${upsertError.message}` }
  }

  revalidatePath('/admin', 'layout')
  return { ok: true, id: saved.id }
}

/** Replaces the add-on groups an item offers. Upserts first, then prunes, so a failure never leaves an item with none. */
export async function setItemOptionGroups(itemId: string, groupIds: string[]): Promise<ActionResult> {
  const staff = await getCurrentStaff()
  if (staff?.role !== 'owner') return { ok: false, message: 'Only the owner can change add-ons.' }

  const ids = [...new Set(groupIds)]
  const db = await getServerClient()

  // Archived items are allowed: that is how an item is un-archived.
  const { data: item } = await db.from('menu_items').select('id').eq('id', itemId).maybeSingle()
  if (!item) return { ok: false, message: 'Item not found.' }

  if (ids.length > 0) {
    const { data: found, error: groupsError } = await db.from('option_groups').select('id').in('id', ids)
    if (groupsError) return { ok: false, message: `Could not update add-ons: ${groupsError.message}` }
    if ((found ?? []).length !== ids.length) {
      return { ok: false, message: 'One of those add-on groups no longer exists.' }
    }

    const { error: upsertError } = await db
      .from('item_option_groups')
      .upsert(ids.map((group_id, sort_order) => ({ item_id: itemId, group_id, sort_order })), {
        onConflict: 'item_id,group_id',
      })
    if (upsertError) return { ok: false, message: `Could not update add-ons: ${upsertError.message}` }
  }

  let prune = db.from('item_option_groups').delete().eq('item_id', itemId)
  if (ids.length > 0) prune = prune.not('group_id', 'in', `(${ids.join(',')})`)
  const { error: pruneError } = await prune
  if (pruneError) return { ok: false, message: `Could not update add-ons: ${pruneError.message}` }

  revalidatePath('/admin', 'layout')
  return { ok: true }
}

export async function archiveMenuItem(id: string) {
  await requireOwner()
  const db = await getServerClient()

  const { error } = await db
    .from('menu_items')
    .update({ is_archived: true, is_available: false })
    .eq('id', id)

  if (error) throw new Error(`Could not archive the drink: ${error.message}`)

  revalidatePath('/admin/menu')
  revalidatePath('/')
  revalidatePath('/admin', 'layout')
}

export async function uploadMenuImage(itemId: string, file: File) {
  await requireOwner()
  const db = await getServerClient()

  const bytes = new Uint8Array(await file.arrayBuffer())
  const check = validateImage(bytes, file.size)
  if (!check.ok) throw new Error(check.error)

  const { data: existing } = await db
    .from('menu_items')
    .select('image_path')
    .eq('id', itemId)
    .maybeSingle()

  // A fresh UUID per upload, so a replacement never collides with a
  // CDN-cached predecessor and the new photo shows immediately.
  const path = `menu/${itemId}/${crypto.randomUUID()}.${check.extension}`

  const { error: uploadError } = await db.storage
    .from(IMAGE_BUCKET)
    .upload(path, bytes, { contentType: check.contentType, upsert: false })
  if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`)

  const { error: updateError } = await db
    .from('menu_items')
    .update({ image_path: path })
    .eq('id', itemId)

  if (updateError) {
    // Roll the object back so a failed update does not leave a billed orphan.
    await db.storage.from(IMAGE_BUCKET).remove([path])
    throw new Error(`Could not attach the image: ${updateError.message}`)
  }

  if (existing?.image_path) {
    await db.storage.from(IMAGE_BUCKET).remove([existing.image_path])
  }

  revalidatePath('/admin/menu')
  revalidatePath('/')
  revalidatePath('/admin', 'layout')
}

export async function removeMenuImage(itemId: string) {
  await requireOwner()
  const db = await getServerClient()

  const { data: existing } = await db
    .from('menu_items')
    .select('image_path')
    .eq('id', itemId)
    .maybeSingle()

  const { error } = await db
    .from('menu_items')
    .update({ image_path: null })
    .eq('id', itemId)
  if (error) throw new Error(`Could not remove the image: ${error.message}`)

  if (existing?.image_path) {
    await db.storage.from(IMAGE_BUCKET).remove([existing.image_path])
  }

  revalidatePath('/admin/menu')
  revalidatePath('/')
  revalidatePath('/admin', 'layout')
}

type ActionResult = { ok: true } | { ok: false; message: string }

/** Inline edits are drafts: they revalidate the admin but never publish. */
export async function updateVariantPrice(
  itemId: string,
  code: VariantCode,
  raw: string,
): Promise<{ ok: true; priceCentavos: number | null } | { ok: false; message: string }> {
  const staff = await getCurrentStaff()
  if (staff?.role !== 'owner') return { ok: false, message: 'Only the owner can change prices.' }
  if (!(code in VARIANT_META)) return { ok: false, message: 'Unknown size.' }

  let priceCentavos: number | null
  try {
    priceCentavos = parsePriceInput(raw)
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Enter a valid price' }
  }

  const db = await getServerClient()
  const { data: found } = await db
    .from('menu_items')
    .select('id, menu_categories!inner ( kind )')
    .eq('id', itemId)
    .maybeSingle()
  if (!found) return { ok: false, message: 'Item not found.' }
  const rawCategory = (found as unknown as { menu_categories: { kind: CategoryKind } | { kind: CategoryKind }[] }).menu_categories
  const kind = (Array.isArray(rawCategory) ? rawCategory[0] : rawCategory).kind
  if (!variantCodesFor(kind).includes(code)) {
    return { ok: false, message: 'That size does not apply to this item.' }
  }

  const now = new Date().toISOString()

  if (priceCentavos === null) {
    // Blank archives the size, so history and a later re-price keep working.
    const { error } = await db
      .from('menu_variants')
      .update({ is_archived: true, updated_at: now })
      .eq('item_id', itemId)
      .eq('code', code)
    if (error) return { ok: false, message: `Could not clear the price: ${error.message}` }
  } else {
    const meta = VARIANT_META[code]
    const { error } = await db.from('menu_variants').upsert(
      {
        item_id: itemId,
        code,
        label: meta.label,
        price_centavos: priceCentavos,
        temperature: meta.temperature,
        sort_order: meta.sortOrder,
        is_archived: false,
        updated_at: now,
      },
      { onConflict: 'item_id,code' },
    )
    if (error) return { ok: false, message: `Could not save the price: ${error.message}` }
  }

  revalidatePath('/admin', 'layout')
  return { ok: true, priceCentavos }
}

export async function setBestseller(itemId: string, value: boolean): Promise<ActionResult> {
  const staff = await getCurrentStaff()
  if (staff?.role !== 'owner') return { ok: false, message: 'Only the owner can change bestsellers.' }

  const db = await getServerClient()
  const { error } = await db
    .from('menu_items')
    .update({ is_bestseller: value, updated_at: new Date().toISOString() })
    .eq('id', itemId)
  if (error) return { ok: false, message: `Could not update bestseller: ${error.message}` }

  revalidatePath('/admin', 'layout')
  return { ok: true }
}

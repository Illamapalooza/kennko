'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getServerClient } from '@/lib/supabase/server'
import { requireStaff, requireOwner } from '@/lib/auth/session'
import { mapMenuRows } from '@/lib/menu/queries'
import { validateImage } from '@/lib/images/validate'
import { publishMenu } from '@/lib/menu/publish'
import { drinkGroupLinksFor, type DrinkGroupLinkRow } from './drink-groups'
import { VARIANT_META, parseVariantPrices, variantCodesFor, type CategoryKind } from './format'
import type { AdminMenuCategory, VariantCode } from '@/lib/menu/types'

const IMAGE_BUCKET = 'menu-images'

const ALL_CODES = Object.keys(VARIANT_META) as VariantCode[]

export async function publishMenuNow(): Promise<{ ok: true; version: number } | { ok: false; message: string }> {
  await requireOwner()
  const result = await publishMenu()
  if (result.ok) {
    revalidatePath('/')
    revalidatePath('/admin', 'layout')
  }
  return result
}

export async function getAdminMenu(): Promise<AdminMenuCategory[]> {
  await requireStaff()
  const db = await getServerClient()

  const { data, error } = await db
    .from('menu_categories')
    .select(
      `id, name, kind, sort_order,
       menu_items ( id, name, description, image_path, is_bestseller,
                    is_available, sort_order,
                    menu_variants ( code, price_centavos, is_archived ) )`,
    )
    .order('sort_order')

  if (error) throw new Error(`Failed to load menu: ${error.message}`)
  return mapMenuRows((data ?? []) as never)
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
}

export async function saveMenuItem(formData: FormData) {
  await requireOwner()
  const db = await getServerClient()

  const id = String(formData.get('id') ?? '') || null
  const name = String(formData.get('name') ?? '').trim()
  const categoryId = String(formData.get('category_id') ?? '')
  const description = String(formData.get('description') ?? '').trim() || null
  const isBestseller = formData.get('is_bestseller') === 'on'

  if (!name) throw new Error('Enter a name for the drink')
  if (!categoryId) throw new Error('Choose a category')

  const { data: category, error: categoryError } = await db
    .from('menu_categories')
    .select('kind')
    .eq('id', categoryId)
    .single()
  if (categoryError || !category) throw new Error('Choose a category')
  const kind = category.kind as CategoryKind

  const prices = parseVariantPrices(formData, kind)
  if (Object.values(prices).every((v) => v === null)) {
    throw new Error(kind === 'food' ? 'Set a price' : 'Set a price for at least one size')
  }

  const row = {
    name,
    category_id: categoryId,
    description,
    is_bestseller: isBestseller,
    updated_at: new Date().toISOString(),
  }

  const { data: saved, error } = id
    ? await db.from('menu_items').update(row).eq('id', id).select('id').single()
    : await db.from('menu_items').insert(row).select('id').single()

  if (error) throw new Error(`Could not save the drink: ${error.message}`)

  // A new drink gets the drink add-on groups, or checkout would refuse every add-on on it. Food gets none.
  if (!id && kind === 'drink') {
    const { data: linked, error: linkedError } = await db
      .from('item_option_groups')
      .select('group_id, sort_order, menu_items!inner ( is_archived, menu_categories!inner ( kind ) )')
    if (linkedError) throw new Error(`Could not load the add-on groups: ${linkedError.message}`)
    const links = drinkGroupLinksFor(saved.id, (linked ?? []) as unknown as DrinkGroupLinkRow[])
    if (links.length > 0) {
      const { error: linkError } = await db.from('item_option_groups').insert(links)
      if (linkError) throw new Error(`Could not attach the add-ons: ${linkError.message}`)
    }
  }

  // A blank price archives the variant rather than deleting it, so history and a later re-price keep working.
  const offered = variantCodesFor(kind).filter((code) => prices[code] !== null)
  const toUpsert = offered.map((code) => ({
    item_id: saved.id,
    code,
    label: VARIANT_META[code].label,
    price_centavos: prices[code] as number,
    temperature: VARIANT_META[code].temperature,
    sort_order: VARIANT_META[code].sortOrder,
    is_archived: false,
    updated_at: new Date().toISOString(),
  }))
  const toArchive = ALL_CODES.filter((code) => !offered.includes(code))

  if (toUpsert.length > 0) {
    const { error: upsertError } = await db
      .from('menu_variants')
      .upsert(toUpsert, { onConflict: 'item_id,code' })
    if (upsertError) throw new Error(`Could not save prices: ${upsertError.message}`)
  }

  const { error: archiveError } = await db
    .from('menu_variants')
    .update({ is_archived: true, updated_at: new Date().toISOString() })
    .eq('item_id', saved.id)
    .in('code', toArchive)
  if (archiveError) throw new Error(`Could not clear prices: ${archiveError.message}`)

  revalidatePath('/admin/menu')
  revalidatePath('/')
  revalidatePath('/admin', 'layout')
  redirect('/admin/menu')
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
}

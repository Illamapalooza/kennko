'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getServerClient } from '@/lib/supabase/server'
import { requireStaff, requireOwner } from '@/lib/auth/session'
import { mapMenuRows } from '@/lib/menu/queries'
import { validateImage } from '@/lib/images/validate'
import { SIZES, parseSizePrices } from './format'
import type { MenuCategoryWithItems } from '@/lib/menu/types'

const IMAGE_BUCKET = 'menu-images'

export async function getAdminMenu(): Promise<MenuCategoryWithItems[]> {
  await requireStaff()
  const db = await getServerClient()

  const { data, error } = await db
    .from('menu_categories')
    .select(
      `id, name, sort_order,
       menu_items ( id, name, description, image_path, is_bestseller,
                    is_available, sort_order,
                    menu_item_prices ( size, price_centavos ) )`,
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

  const prices = parseSizePrices(formData)
  if (Object.values(prices).every((v) => v === null)) {
    throw new Error('Set a price for at least one size')
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

  // Sizes left blank are removed, so "not offered" round-trips correctly.
  const toUpsert = SIZES.filter((s) => prices[s] !== null).map((size) => ({
    menu_item_id: saved.id,
    size,
    price_centavos: prices[size] as number,
  }))
  const toDelete = SIZES.filter((s) => prices[s] === null)

  if (toUpsert.length > 0) {
    const { error: upsertError } = await db
      .from('menu_item_prices')
      .upsert(toUpsert, { onConflict: 'menu_item_id,size' })
    if (upsertError) throw new Error(`Could not save prices: ${upsertError.message}`)
  }

  if (toDelete.length > 0) {
    const { error: deleteError } = await db
      .from('menu_item_prices')
      .delete()
      .eq('menu_item_id', saved.id)
      .in('size', toDelete)
    if (deleteError) throw new Error(`Could not clear prices: ${deleteError.message}`)
  }

  revalidatePath('/admin/menu')
  revalidatePath('/')
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

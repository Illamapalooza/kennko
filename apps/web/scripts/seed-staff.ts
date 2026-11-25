import { createClient } from '@supabase/supabase-js'
import { hashStaffPin } from '@kennko/core/staff-pin'
import type { CatLook } from '@kennko/core'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !serviceKey) {
  throw new Error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY')
}

const DEFAULT_PIN = '123456'
const DEFAULT_OWNER_PASSWORD = process.env.SEED_OWNER_PASSWORD || 'KennkoAdmin2026!'
const RESET_PINS = process.argv.includes('--reset-pins')

type SeedStaff = {
  fullName: string
  role: 'owner' | 'barista'
  emailEnv?: string
  defaultEmail?: string
  catLook: CatLook
}

export const SEED_STAFF: SeedStaff[] = [
  // Owners / Admins (can also act as baristas on the POS)
  {
    fullName: 'Julius Baliling',
    role: 'owner',
    emailEnv: 'SEED_OWNER_EMAIL_JULIUS',
    defaultEmail: 'julius@kennkokape.com',
    catLook: { coat: 'tuxedo', hat: 'owner-crown', face: 'round-glasses', neck: 'gold-apron', held: 'portafilter' },
  },
  {
    fullName: 'Juluis Baliling',
    role: 'owner',
    emailEnv: 'SEED_OWNER_EMAIL_JULUIS',
    defaultEmail: 'juluis@kennkokape.com',
    catLook: { coat: 'ginger', hat: 'barista-cap', face: 'barista-shades', neck: 'gold-apron', held: 'milk-pitcher' },
  },
  {
    fullName: 'Kenn Baliling',
    role: 'owner',
    emailEnv: 'SEED_OWNER_EMAIL_KENN',
    defaultEmail: 'kenn@kennkokape.com',
    catLook: { coat: 'siamese', hat: 'chef-beret', face: 'headset', neck: 'coffee-pin', held: 'tamper' },
  },
  {
    fullName: 'Kahlea Baliling',
    role: 'owner',
    emailEnv: 'SEED_OWNER_EMAIL_KAHLEA',
    defaultEmail: 'kahlea@kennkokape.com',
    catLook: { coat: 'calico', hat: 'beanie', face: 'blush', neck: 'gold-apron', held: 'kennko-cup' },
  },
  // Baristas
  {
    fullName: 'Liam',
    role: 'barista',
    catLook: { coat: 'tabby', hat: 'barista-cap', face: 'headset', neck: 'coffee-pin', held: 'portafilter' },
  },
  {
    fullName: 'Wyn',
    role: 'barista',
    catLook: { coat: 'cream', hat: 'chef-beret', face: 'round-glasses', neck: 'bow-tie', held: 'milk-pitcher' },
  },
  {
    fullName: 'Lawrence',
    role: 'barista',
    catLook: { coat: 'black', hat: 'visor', face: 'barista-shades', neck: 'bandana', held: 'tamper' },
  },
]

const db = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

async function ensureAuthUser(email: string, password: string): Promise<string> {
  const { data: created, error } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (!error && created.user) return created.user.id

  // Already exists in auth.users — look up by email.
  const { data: listed, error: listErr } = await db.auth.admin.listUsers({ perPage: 200 })
  if (listErr) throw listErr
  const found = listed.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())
  if (!found) throw error ?? new Error(`Could not create or find auth user for ${email}`)
  return found.id
}

async function main() {
  const now = new Date().toISOString()
  const { data: existingRows, error: fetchErr } = await db
    .from('staff')
    .select('id, full_name, email, role, user_id, pin_hash, cat_look')
  if (fetchErr) throw fetchErr
  const existing = existingRows ?? []

  for (const person of SEED_STAFF) {
    const email = person.role === 'owner'
      ? (person.emailEnv && process.env[person.emailEnv]?.trim()) || person.defaultEmail!
      : null

    const match = existing.find(
      (r) =>
        r.full_name.toLowerCase() === person.fullName.toLowerCase() ||
        (email && r.email?.toLowerCase() === email.toLowerCase()),
    )

    if (match) {
      const patch: Record<string, unknown> = {
        full_name: person.fullName,
        role: person.role,
        is_active: true,
        updated_at: now,
      }
      if (!match.cat_look) patch.cat_look = person.catLook
      if (!match.pin_hash || RESET_PINS) {
        patch.pin_hash = await hashStaffPin(DEFAULT_PIN)
        patch.pin_updated_at = now
      }
      if (person.role === 'owner' && !match.user_id && email) {
        patch.user_id = await ensureAuthUser(email, DEFAULT_OWNER_PASSWORD)
        patch.email = email
      }
      const { error: updErr } = await db.from('staff').update(patch).eq('id', match.id)
      if (updErr) throw updErr
      console.log(`Updated ${person.role}: ${person.fullName}${match.email || email ? ` (${match.email || email})` : ''}`)
      continue
    }

    const userId = person.role === 'owner' && email ? await ensureAuthUser(email, DEFAULT_OWNER_PASSWORD) : null
    const pinHash = await hashStaffPin(DEFAULT_PIN)
    const { error: insErr } = await db.from('staff').insert({
      user_id: userId,
      email,
      full_name: person.fullName,
      role: person.role,
      is_active: true,
      pin_hash: pinHash,
      pin_updated_at: now,
      cat_look: person.catLook,
      created_at: now,
      updated_at: now,
    })
    if (insErr) throw insErr
    console.log(`Created ${person.role}: ${person.fullName}${email ? ` (${email})` : ''}`)
  }

  console.log(`\nSeeded ${SEED_STAFF.length} staff members (4 owners + 3 baristas) with starter till PIN ${DEFAULT_PIN}.`)
  console.log('Remind everyone to change their till PIN in Admin > Staff!')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

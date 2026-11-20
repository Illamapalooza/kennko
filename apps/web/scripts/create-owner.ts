import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const email = process.argv[2]
const password = process.argv[3]
const fullName = process.argv[4]

if (!url || !serviceKey) throw new Error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY')
if (!email || !password || !fullName) {
  throw new Error('Usage: npm run create-owner -- <email> <password> "<Full Name>"')
}
if (password.length < 12) {
  throw new Error('Choose a password of at least 12 characters')
}

const db = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

async function main() {
  const { data: created, error: authError } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (authError) throw authError

  const { error: staffError } = await db.from('staff').insert({
    user_id: created.user.id,
    email,
    full_name: fullName,
    role: 'owner',
    is_active: true,
  })
  if (staffError) throw staffError

  console.log(`Created owner ${email} (${created.user.id})`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

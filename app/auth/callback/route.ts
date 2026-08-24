import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getServerClient } from '@/lib/supabase/server'
import { safeNextPath } from '@/lib/auth/redirect'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const error = searchParams.get('error_description') ?? searchParams.get('error')

  const next = safeNextPath(searchParams.get('next'))

  if (error) {
    return NextResponse.redirect(`${origin}/account?error=${encodeURIComponent(error)}`)
  }
  if (!code) {
    return NextResponse.redirect(`${origin}/account?error=missing-code`)
  }

  const db = await getServerClient()
  const { error: exchangeError } = await db.auth.exchangeCodeForSession(code)

  if (exchangeError) {
    return NextResponse.redirect(
      `${origin}/account?error=${encodeURIComponent(exchangeError.message)}`,
    )
  }

  return NextResponse.redirect(`${origin}${next}`)
}

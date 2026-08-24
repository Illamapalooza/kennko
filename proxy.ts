import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export async function proxy(request: NextRequest) {
  // The admin layout cannot read the current path, so hand it over explicitly.
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-pathname', request.nextUrl.pathname)
  const response = NextResponse.next({ request: { headers: requestHeaders } })

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return response

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (items) => {
        items.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        )
      },
    },
  })

  // Touching the user refreshes an expired token and writes the new cookie.
  await supabase.auth.getUser()

  return response
}

export const config = {
  // Scoped deliberately: the marketing page and the catalog must stay
  // statically cacheable, so they are not listed here.
  matcher: ['/admin/:path*', '/orders/:path*', '/account/:path*', '/auth/:path*'],
}

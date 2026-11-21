import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export async function proxy(request: NextRequest) {
  // The admin layout cannot read the current path, so hand it over explicitly.
  // Built from the request's headers at call time, so cookies set on the request below are forwarded.
  const forward = () => {
    const requestHeaders = new Headers(request.headers)
    requestHeaders.set('x-pathname', request.nextUrl.pathname)
    return NextResponse.next({ request: { headers: requestHeaders } })
  }
  let response = forward()

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return response

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (items) => {
        // Supabase's pattern: the refreshed token goes on the request too, so the page rendered
        // from this request sees it, and on the response, so the browser keeps it.
        items.forEach(({ name, value }) => request.cookies.set(name, value))
        response = forward()
        items.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
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
  matcher: ['/admin/:path*', '/orders/:path*', '/account/:path*', '/auth/:path*', '/here/:path*'],
}

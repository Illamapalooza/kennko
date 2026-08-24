'use client'

import { signOut } from '@/app/admin/login/actions'

export function SignOutButton() {
  return (
    <form action={signOut}>
      <button className="btn btn-secondary" type="submit">
        Sign out
      </button>
    </form>
  )
}

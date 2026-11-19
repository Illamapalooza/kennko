import { redirect } from 'next/navigation'

export default function NewMenuItemPage() {
  redirect('/admin/menu?new=1')
}

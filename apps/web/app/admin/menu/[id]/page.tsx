import { redirect } from 'next/navigation'

export default async function EditMenuItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  redirect(`/admin/menu?edit=${encodeURIComponent(id)}`)
}

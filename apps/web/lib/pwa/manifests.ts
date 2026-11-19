import type { MetadataRoute } from 'next'

type Manifest = MetadataRoute.Manifest

const icons: NonNullable<Manifest['icons']> = [
  { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
  { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
  { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
]

export const websiteManifest: Manifest = {
  name: 'Kennko Coffee',
  short_name: 'Kennko',
  description: 'Bold coffee. Fun sips. Good energy. Order ahead from Kennko Coffee in Butuan City.',
  id: '/',
  start_url: '/',
  scope: '/',
  display: 'standalone',
  background_color: '#fff5f0',
  theme_color: '#0055ff',
  lang: 'en-PH',
  icons,
}

/** Scoped to /admin so installing from any admin page installs the admin app, not the website. */
export const adminManifest: Manifest = {
  name: 'Kennko Admin',
  short_name: 'Admin',
  description: 'Orders, menu and staff for Kennko Coffee.',
  id: '/admin',
  start_url: '/admin',
  scope: '/admin',
  display: 'standalone',
  background_color: '#ffffff',
  theme_color: '#0055ff',
  lang: 'en-PH',
  icons,
}

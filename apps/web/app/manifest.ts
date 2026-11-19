import type { MetadataRoute } from 'next'
import { websiteManifest } from '@/lib/pwa/manifests'

export default function manifest(): MetadataRoute.Manifest {
  return websiteManifest
}

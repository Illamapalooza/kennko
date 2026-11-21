import type { Bootstrap } from './api.ts'

export function gateNote(o: { pinMode: Bootstrap['pinMode']; host: Bootstrap['host']; noLeads: boolean }): string | null {
  if (o.pinMode === 'per-person' && o.noLeads) {
    return 'No PINs yet. The owner issues them in admin › Staff, then tap Try again.'
  }
  return null
}

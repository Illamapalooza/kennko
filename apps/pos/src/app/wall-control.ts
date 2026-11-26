const PROJECTOR_HOST_KEY = 'kennko-projector-host'
export const DEFAULT_PROJECTOR_HOST = '192.168.1.21'

type WallControlPlugin = {
  openProjector(opts?: { host?: string }): Promise<{ ok: boolean; host?: string; port?: number; error?: string }>
}

function getPlugin(): WallControlPlugin | undefined {
  return (window as unknown as { Capacitor?: { Plugins?: { KennkoWallControl?: WallControlPlugin } } })
    ?.Capacitor?.Plugins?.KennkoWallControl
}

export function loadProjectorHost(): string {
  try {
    return localStorage.getItem(PROJECTOR_HOST_KEY)?.trim() || DEFAULT_PROJECTOR_HOST
  } catch {
    return DEFAULT_PROJECTOR_HOST
  }
}

export function saveProjectorHost(host: string): void {
  try {
    const clean = host.trim()
    if (!clean || clean === DEFAULT_PROJECTOR_HOST) localStorage.removeItem(PROJECTOR_HOST_KEY)
    else localStorage.setItem(PROJECTOR_HOST_KEY, clean)
  } catch {
    /* ignore storage errors */
  }
}

export async function openProjectorWall(hostOverride?: string): Promise<{ ok: boolean; message: string }> {
  const plugin = getPlugin()
  if (!plugin) {
    return { ok: false, message: 'Open Wall only works on the Android POS tablet.' }
  }
  const host = (hostOverride ?? loadProjectorHost()).trim() || DEFAULT_PROJECTOR_HOST
  try {
    const res = await plugin.openProjector({ host })
    if (res.ok) {
      if (res.host) saveProjectorHost(res.host)
      return { ok: true, message: `Opened Kennko Wall on projector (${res.host ?? host}).` }
    }
    return { ok: false, message: res.error || 'Could not reach the projector.' }
  } catch {
    return { ok: false, message: 'Could not reach the projector on Wi-Fi.' }
  }
}

export type Transport = {
  call(method: 'GET' | 'POST', path: string, body?: unknown, signal?: AbortSignal): Promise<{ status: number; data: any }>
  follow(onLive: (json: string) => void, onDown: (closed: boolean) => void): () => void
  download(path: string, filename: string): Promise<void>
  exportBackup?: () => Promise<void>
}

export const httpTransport: Transport = {
  async call(method, path, body, signal) {
    const res = await fetch(path, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    })
    const data = await res.json().catch(() => ({}))
    return { status: res.status, data }
  },

  follow(onLive, onDown) {
    const source = new EventSource('/api/events')
    source.onmessage = (event) => onLive(event.data)
    source.onerror = () => onDown(source.readyState === EventSource.CLOSED)
    return () => source.close()
  },

  async download(path, filename) {
    const a = document.createElement('a')
    a.href = path
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
  },
}

let current: Transport = httpTransport

export function getTransport(): Transport {
  return current
}

export function setTransport(t: Transport): void {
  current = t
}

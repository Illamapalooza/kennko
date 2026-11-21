import type { CapacitorHttp } from '@capacitor/core'

export function nativeFetch(http: Pick<typeof CapacitorHttp, 'request'>): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
    const signal = init?.signal

    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError')
    }

    const headers: Record<string, string> = {}
    if (init?.headers) {
      new Headers(init.headers).forEach((v, k) => { headers[k] = v })
    }

    let data: unknown = undefined
    if (init?.body !== undefined && init?.body !== null) {
      const raw = typeof init.body === 'string' ? init.body : String(init.body)
      const ct = Object.entries(headers).find(([k]) => k.toLowerCase() === 'content-type')?.[1] ?? ''
      if (ct.includes('application/json')) {
        try { data = JSON.parse(raw) } catch { data = raw }
      } else {
        data = raw
      }
    }

    const reqPromise = http.request({
      url,
      method,
      headers,
      data,
      responseType: 'text',
    }).then(
      (res) => {
        const bodyText = typeof res.data === 'string' ? res.data : res.data == null ? '' : JSON.stringify(res.data)
        const resHeaders = new Headers()
        if (res.headers) {
          for (const [k, v] of Object.entries(res.headers)) {
            if (typeof v === 'string') resHeaders.set(k, v)
          }
        }
        return new Response(bodyText, { status: res.status, headers: resHeaders })
      },
      (err) => {
        throw new TypeError(err instanceof Error ? err.message : String(err))
      },
    )

    if (!signal) return reqPromise

    return new Promise<Response>((resolve, reject) => {
      const onAbort = () => reject(new DOMException('Aborted', 'AbortError'))
      signal.addEventListener('abort', onAbort, { once: true })
      reqPromise.then(
        (res) => { signal.removeEventListener('abort', onAbort); resolve(res) },
        (err) => { signal.removeEventListener('abort', onAbort); reject(err) },
      )
    })
  }
}

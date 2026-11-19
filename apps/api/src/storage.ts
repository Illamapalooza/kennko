/**
 * Payment proofs in Supabase Storage (private bucket `payment-proofs`), over the Storage REST API.
 * The only place the service-role key is used: SQL goes through DATABASE_URL as kennko_api.
 */
export type ProofStore = {
  upload(path: string, bytes: Uint8Array, contentType: string): Promise<void>
  remove(path: string): Promise<void>
  signedUrl(path: string, seconds: number): Promise<string>
}

const BUCKET = 'payment-proofs'

const encodePath = (path: string) => path.split('/').map(encodeURIComponent).join('/')

export function createProofStore(supabaseUrl: string, serviceKey: string): ProofStore {
  const base = `${supabaseUrl.replace(/\/+$/, '')}/storage/v1`
  const auth = { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey }

  async function ensureOk(res: Response, what: string): Promise<void> {
    if (res.ok) return
    const text = await res.text().catch(() => '')
    throw new Error(`Storage ${what} failed (${res.status}): ${text.slice(0, 200)}`)
  }

  return {
    async upload(path, bytes, contentType) {
      const res = await fetch(`${base}/object/${BUCKET}/${encodePath(path)}`, {
        method: 'POST',
        headers: { ...auth, 'Content-Type': contentType, 'x-upsert': 'false' },
        body: bytes as Uint8Array<ArrayBuffer>,
      })
      await ensureOk(res, 'upload')
    },

    async remove(path) {
      const res = await fetch(`${base}/object/${BUCKET}`, {
        method: 'DELETE',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefixes: [path] }),
      })
      await ensureOk(res, 'remove')
    },

    async signedUrl(path, seconds) {
      const res = await fetch(`${base}/object/sign/${BUCKET}/${encodePath(path)}`, {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ expiresIn: seconds }),
      })
      await ensureOk(res, 'sign')
      const { signedURL } = (await res.json()) as { signedURL: string }
      return `${base}${signedURL}`
    },
  }
}

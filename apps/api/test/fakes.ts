import type { ProofStore } from '../src/storage.js'

export type FakeProofStore = ProofStore & {
  uploads: { path: string; contentType: string; size: number }[]
  removed: string[]
  failUpload: boolean
}

/** Records every call; set `failUpload` to make the next uploads throw. */
export function fakeProofs(): FakeProofStore {
  const store: FakeProofStore = {
    uploads: [],
    removed: [],
    failUpload: false,
    async upload(path, bytes, contentType) {
      if (store.failUpload) throw new Error('storage is down')
      store.uploads.push({ path, contentType, size: bytes.length })
    },
    async remove(path) {
      store.removed.push(path)
    },
    async signedUrl(path, seconds) {
      return `https://storage.test/${path}?expires=${seconds}`
    },
  }
  return store
}

import { randomUUID } from 'node:crypto'
import type { AuthAdmin } from '../src/auth-admin.js'
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

/** Runs the deferred push work to completion so assertions are deterministic. */
export const inlineDefer = async (task: () => Promise<void>): Promise<void> => {
  await task()
}

export type FakeAuthUser = { email: string | null; emailConfirmed: boolean }

export type FakeAuthAdmin = AuthAdmin & {
  /** Keyed by user id; a missing id answers null, as GoTrue's 404 does. */
  users: Record<string, FakeAuthUser>
  /** Set to make getUser throw, as when Supabase Auth is down. */
  failGetUser: boolean
  lookups: string[]
  invited: string[]
  deleted: string[]
}

/** In-memory Supabase Auth admin: records every call, never touches the network. */
export function fakeAuthAdmin(users: Record<string, FakeAuthUser> = {}): FakeAuthAdmin {
  const admin: FakeAuthAdmin = {
    users,
    failGetUser: false,
    lookups: [],
    invited: [],
    deleted: [],
    async getUser(id) {
      admin.lookups.push(id)
      if (admin.failGetUser) throw new Error('Auth getUser failed (timeout)')
      return admin.users[id] ?? null
    },
    async invite(email) {
      admin.invited.push(email)
      return { userId: randomUUID() }
    },
    async deleteUser(id) {
      admin.deleted.push(id)
    },
  }
  return admin
}

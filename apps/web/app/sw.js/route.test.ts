import { afterEach, describe, expect, it, vi } from 'vitest'

async function body() {
  vi.resetModules()
  const { GET } = await import('./route')
  return GET().text()
}

afterEach(() => vi.unstubAllEnvs())

describe('GET /sw.js', () => {
  it('uses the commit sha as the build id', async () => {
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', 'abcdef1234567890')
    expect(await body()).toContain('"abcdef123456"')
  })

  it('falls back to a local build id when the sha is empty', async () => {
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', '')
    expect(await body()).toMatch(/"local-[0-9a-z]+"/)
  })
})

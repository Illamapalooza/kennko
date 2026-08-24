import { describe, expect, it } from 'vitest'
import { readEnv } from './env'

describe('readEnv', () => {
  it('returns config when all required vars are present', () => {
    const result = readEnv({
      NEXT_PUBLIC_SUPABASE_URL: 'https://abc.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
    })
    expect(result.supabaseUrl).toBe('https://abc.supabase.co')
    expect(result.supabaseAnonKey).toBe('anon-key')
  })

  it('throws naming the missing variable', () => {
    expect(() =>
      readEnv({ NEXT_PUBLIC_SUPABASE_URL: 'https://abc.supabase.co' }),
    ).toThrow('NEXT_PUBLIC_SUPABASE_ANON_KEY')
  })

  it('rejects a non-https supabase url', () => {
    expect(() =>
      readEnv({
        NEXT_PUBLIC_SUPABASE_URL: 'http://abc.supabase.co',
        NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
      }),
    ).toThrow('must be https')
  })
})

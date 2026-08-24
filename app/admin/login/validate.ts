const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function validateCredentials(email: string, password: string): string | null {
  if (!email) return 'Enter your email address.'
  if (!EMAIL_PATTERN.test(email)) return 'Enter a valid email address.'
  if (!password) return 'Enter your password.'
  return null
}

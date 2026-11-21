// Supabase rejects passwords over 72 bytes (bcrypt); 8 is our own floor.
export const PASSWORD_MIN = 8
export const PASSWORD_MAX = 72

export function validateNewPassword(password: string, confirm: string): string | null {
  if (password.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`
  if (new TextEncoder().encode(password).length > PASSWORD_MAX) return 'That password is too long.'
  if (password !== confirm) return 'The two passwords do not match.'
  return null
}

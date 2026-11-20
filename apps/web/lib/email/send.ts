import 'server-only'

type SendArgs = { to: string[]; subject: string; text: string; html?: string }

/**
 * A missing RESEND_API_KEY logs and continues rather than throwing. Email is a
 * notification, not the record of the order -- losing a paid order because a
 * key was not configured would be far worse than a missed email.
 */
export async function sendEmail({ to, subject, text, html }: SendArgs): Promise<boolean> {
  const key = process.env.RESEND_API_KEY
  const from = process.env.ORDER_EMAIL_FROM ?? 'Kennko Coffee <onboarding@resend.dev>'

  if (!key) {
    console.warn(`[email] RESEND_API_KEY not set — would have sent "${subject}" to ${to.join(', ')}`)
    return false
  }
  if (to.length === 0) {
    console.warn(`[email] no recipients for "${subject}"`)
    return false
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to, subject, text, ...(html ? { html } : {}) }),
    })

    if (!response.ok) {
      console.error(`[email] Resend rejected "${subject}": ${await response.text()}`)
      return false
    }
    return true
  } catch (cause) {
    console.error(`[email] send failed for "${subject}"`, cause)
    return false
  }
}

export async function activeStaffEmails(): Promise<string[]> {
  const { getAdminClient } = await import('@/lib/supabase/admin')
  const { data } = await getAdminClient()
    .from('staff')
    .select('email')
    .eq('is_active', true)
  return (data ?? []).map((row: { email: string }) => row.email)
}

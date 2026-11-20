import 'server-only'
import { webKeyFetch } from '@/lib/api/client'

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

/**
 * Who gets the new-order alert: active staff with an email, from the API's web-key route (Ruling 13;
 * the checkout has no signed-in user). Unset key, an API error or a bad body all give [] with a log
 * line: the alert is skipped, and the checkout carries on.
 */
export async function activeStaffEmails(): Promise<string[]> {
  try {
    const res = await webKeyFetch('/v1/staff/alert-emails')
    if (res?.ok) {
      const body = (await res.json()) as { emails?: unknown }
      if (Array.isArray(body.emails) && body.emails.every((e) => typeof e === 'string')) return body.emails
    }
  } catch {
    // Logged below, without the cause: it could carry the request headers.
  }
  console.error('[email] staff alert list unavailable')
  return []
}

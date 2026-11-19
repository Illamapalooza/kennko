import type { Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { AppEnv } from './auth.js'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

export function apiError(status: number, code: string, message: string): HTTPException {
  return new HTTPException(status as ContentfulStatusCode, {
    message,
    res: Response.json({ code, message }, { status }),
  })
}

/** 400 in the order-route error shape. */
export function invalid(message: string) {
  return Response.json({ code: 'INVALID', message, errors: [message] }, { status: 400 })
}

type ActionOutcome =
  | { ok: true; prepStatus: string; paymentStatus: string }
  | { ok: false; status: 404 | 409; code: string; errors: string[] }

export function respond(c: Context<AppEnv>, result: ActionOutcome) {
  if (!result.ok) {
    return c.json({ code: result.code, message: result.errors[0], errors: result.errors }, result.status)
  }
  return c.json({ prepStatus: result.prepStatus, paymentStatus: result.paymentStatus })
}

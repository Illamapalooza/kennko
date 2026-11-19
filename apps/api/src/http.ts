import { HTTPException } from 'hono/http-exception'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

export function apiError(status: number, code: string, message: string): HTTPException {
  return new HTTPException(status as ContentfulStatusCode, {
    message,
    res: Response.json({ code, message }, { status }),
  })
}

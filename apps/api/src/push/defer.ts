import * as vercelFunctions from '@vercel/functions'
import type { AppDeps } from '../create-app.js'

type Task = () => Promise<void>

const waitUntil: ((p: Promise<unknown>) => void) | undefined =
  (vercelFunctions as { waitUntil?: (p: Promise<unknown>) => void }).waitUntil ??
  (vercelFunctions as unknown as { default?: { waitUntil?: (p: Promise<unknown>) => void } }).default?.waitUntil

/**
 * Production `defer`: lets the function finish the task after the response (Vercel `waitUntil`),
 * or just starts it when no request context exists. Never throws, never blocks the response.
 */
export const vercelDefer: AppDeps['defer'] = (task: Task) => {
  const running = task().catch((err) => console.error('deferred push task failed', err))
  try {
    waitUntil?.(running)
  } catch (err) {
    console.error('waitUntil unavailable', err)
  }
}

/** Runs a post-commit task through `deps.defer`. Never throws, whatever `defer` or the task do. */
export async function afterCommit(deps: Pick<AppDeps, 'defer'>, task: Task): Promise<void> {
  try {
    await deps.defer(async () => {
      try {
        await task()
      } catch (err) {
        console.error('post-commit task failed', err)
      }
    })
  } catch (err) {
    console.error('could not defer post-commit task', err)
  }
}

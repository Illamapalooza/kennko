/**
 * Waits for `work` at most `ms`. True when it finished (or failed) in time, false when the wait ran out first; the work
 * itself carries on either way. Never throws. For the few till requests that wait on a sync (Ruling P4-7).
 */
export async function bounded(work: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const waited = new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), ms); (timer as any)?.unref?.() })
  try {
    return await Promise.race([work.then(() => true, () => true), waited])
  } finally {
    clearTimeout(timer)
  }
}

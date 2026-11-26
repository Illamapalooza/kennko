import type { Till } from '../../till/till.ts'
import type { Transport } from '../transport.ts'

export function inAppTransport(
  till: Till,
  opts: {
    shareText?: (filename: string, text: string) => Promise<void>
    exportBackup?: () => Promise<void>
    prepareUpdate?: () => Promise<void>
  } = {},
): Transport {
  let sessionToken: string | undefined

  return {
    async call(method, path, body) {
      const res = await till.request({
        method,
        path,
        body,
        session: sessionToken,
        client: 'android',
      })
      if (res.session !== undefined) {
        sessionToken = res.session === null ? undefined : res.session
      }
      return { status: res.status, data: res.body }
    },

    follow(onLive, onDown) {
      return till.followTablet(
        sessionToken,
        onLive,
        () => onDown(true),
      )
    },

    async download(path, filename) {
      const res = await till.request({
        method: 'GET',
        path,
        session: sessionToken,
        client: 'android',
      })
      if (res.status < 200 || res.status >= 300 || !res.csv) {
        throw new Error((res.body as any)?.error ?? 'Could not export CSV.')
      }
      if (!opts.shareText) throw new Error('Share is not available.')
      await opts.shareText(res.csv.filename || filename, res.csv.text)
    },

    exportBackup: opts.exportBackup,
    prepareUpdate: opts.prepareUpdate,
  }
}

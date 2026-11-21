import type { Till } from '../../till/till.ts'

export function wireFeed(
  till: Pick<Till, 'followWall' | 'wallMenuJson'>,
  feed: {
    publish(o: { frame: string }): Promise<void>
    setMenu(o: { menu: string }): Promise<void>
  },
): () => void {
  let lastMenuKey: string | null = null
  return till.followWall((frame) => {
    try {
      const parsed = JSON.parse(frame)
      const key = typeof parsed?.menuKey === 'string' ? parsed.menuKey : ''
      if (lastMenuKey === null || (key && key !== lastMenuKey)) {
        lastMenuKey = key
        feed.setMenu({ menu: till.wallMenuJson() }).catch(() => {})
      }
    } catch {
      if (lastMenuKey === null) {
        lastMenuKey = ''
        feed.setMenu({ menu: till.wallMenuJson() }).catch(() => {})
      }
    }
    feed.publish({ frame }).catch(() => {})
  })
}

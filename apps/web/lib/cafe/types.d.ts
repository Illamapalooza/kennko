declare module '@/lib/cafe/scene/scene.mjs' {
  export function createScene(
    canvas: HTMLCanvasElement,
    options?: { ambient?: boolean; clock?: () => number },
  ): {
    sync(orders: unknown[], baristas: number, initial?: boolean, visitors?: unknown[]): void
    tick(dt: number): void
    draw(): void
    tags(): Array<{ id: number; text: string; name: string; ready: boolean; x: number; y: number }>
    visitorTags(): Array<{ key: string; name: string; x: number; y: number }>
  }
}

declare module '@/lib/cafe/scene/logic.mjs' {
  export type WallBoardOrder = {
    id: number
    number: number
    series: 'C' | 'W'
    label?: string
    name: string
    items: { name: string; qty: number }[]
    status: 'queued' | 'preparing' | 'serving' | 'done' | 'cancelled'
    fulfilment?: string
    prepStatus?: string
    createdAt: number
    updatedAt: number
  }
  export function boardView(
    orders: WallBoardOrder[],
    cap: number,
  ): {
    queued: { shown: WallBoardOrder[]; more: number }
    preparing: { shown: WallBoardOrder[]; more: number }
    serving: { shown: WallBoardOrder[]; more: number }
  }
  export function deliveryView(orders: WallBoardOrder[]): WallBoardOrder[]
  export function itemsLabel(items: { name: string; qty: number }[]): string
}

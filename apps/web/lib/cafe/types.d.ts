declare module '@/lib/cafe/scene/scene.mjs' {
  export function createScene(
    canvas: HTMLCanvasElement,
    tagLayer: HTMLElement,
    options?: { manilaHour?: () => number; clock?: () => number },
  ): {
    sync(orders: unknown[], baristas: number, initial?: boolean, visitors?: unknown[], baristaCats?: unknown[]): void
    setAmbient(on: boolean): void
    destroy(): void
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

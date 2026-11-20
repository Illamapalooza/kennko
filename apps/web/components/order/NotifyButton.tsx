'use client'

import { PushToggle } from '@/components/PushToggle'
import { subscribeToOrder, unwatchOrder } from '@/app/push-actions'

/** "Notify me about this order": a push when the cafe moves it along. */
export function NotifyButton({ orderCode }: { orderCode: string }) {
  return (
    <PushToggle
      subscribe={(subscription) => subscribeToOrder(orderCode, subscription)}
      labelOff="Notify me about this order"
      labelOn="Notifications on · Turn off"
      className="done-secondary notify-button"
      hintClassName="order-note"
      turnOffOnServer={(endpoint) => unwatchOrder(orderCode, endpoint)}
      storageKey={`kennko-notify-${orderCode}`}
    />
  )
}

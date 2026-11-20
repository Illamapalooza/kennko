'use client'

import { PushToggle } from '@/components/PushToggle'
import { subscribeStaffAlerts, unsubscribePush } from '@/app/push-actions'

/** Staff: a push on this device for every new order. */
export function OrderAlertsButton() {
  return (
    <PushToggle
      subscribe={subscribeStaffAlerts}
      labelOff="Turn on order alerts"
      labelOn="Order alerts on · Turn off"
      className="btn btn-secondary"
      hintClassName="admin-notice"
      turnOffOnServer={unsubscribePush}
      dropBrowserSubscription
      storageKey="kennko-staff-alerts"
    />
  )
}

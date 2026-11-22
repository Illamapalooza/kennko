/**
 * The staff and admin manual, as plain data. Rendered by /admin/guide; no markdown, no HTML.
 * Name screens and buttons exactly as the till and admin show them. Sources: apps/pos/README.md,
 * wall/README.md, apps/api/README.md, deploy/windows/README.md, apps/web/CLAUDE.md and the screens' code.
 */

export type Audience = 'Barista' | 'Manager' | 'Owner'

export type GuideProblem = { problem: string; fix: string }

export type GuideSection = {
  heading: string
  /** Numbered steps, in order. */
  steps?: string[]
  /** "Do it right" tips. */
  tips?: string[]
  /** "If something goes wrong" items. */
  problems?: GuideProblem[]
}

export type GuideTopic = {
  slug: string
  title: string
  /** Who does it. */
  audience: Audience[]
  /** Only the owner can do this. Shown as "Owner only". */
  ownerOnly?: boolean
  summary: string
  sections: GuideSection[]
}

export const AUDIENCES: Audience[] = ['Barista', 'Manager', 'Owner']

export const TOPICS: GuideTopic[] = [
  {
    slug: 'first-time-setup',
    title: 'First-time setup',
    audience: ['Owner'],
    ownerOnly: true,
    summary: 'Sign in, publish the menu, add staff and PINs, connect the till, and get the tablets and the wall going.',
    sections: [
      {
        heading: 'Sign in to admin',
        steps: [
          'Open /admin/login on the website.',
          'Type your email and password, then tap Sign in.',
          'To change your password, tap Set a password (under your name in the menu). Type it twice, then tap Set password.',
        ],
        tips: [
          'Customers never use /admin/login. They sign in on My account with Google or an email link.',
          'Tap Install Kennko Admin on the Overview screen to put admin on your phone like an app.',
        ],
      },
      {
        heading: 'Shop details',
        steps: [
          'The shop name, address and phone on receipts come from Kennko. A connected till picks them up by itself at each sync.',
          'There is no admin screen for them yet. Ask Julius to change them.',
        ],
      },
      {
        heading: 'Publish the menu',
        steps: [
          'Open Menu and check the drinks, prices and photos.',
          'When the bar at the bottom says "Unpublished changes", tap Publish.',
          'The bar then says "Menu published · version N".',
        ],
        tips: ['Nothing reaches the website or the till until you publish. Do this before anything else.'],
      },
      {
        heading: 'Add staff and give them till PINs',
        steps: [
          'Open Staff. Under Add someone, type the full name and pick a role: Barista, Manager or Owner.',
          'Baristas need no email. Leave it empty and tap Add.',
          'For a manager who should use the website, type their email and tap Send invite. An owner always needs an email.',
          'In the person\'s row, tap Set PIN. Write the PIN down and give it to them. It is shown only once.',
          'Lost PIN? Tap New PIN. The old one stops working.',
          'Someone leaving? Tap Deactivate. Reactivate brings them back.',
        ],
        tips: [
          'Give a PIN to everyone who works the till before you connect it.',
          'Make whoever closes the till a Manager (or Owner) with a PIN. Only they can void, take cash out and close.',
        ],
        problems: [
          {
            problem: '"That email already has a website login."',
            fix: 'Use a different email, or ask them to sign in first.',
          },
          { problem: 'You can\'t change one owner\'s role.', fix: 'They are the last owner. Add another owner first.' },
        ],
      },
      {
        heading: 'Connect the till',
        steps: [
          'Do this outside opening hours. Connecting signs every tablet out once.',
          'In admin, open Tills. Under Add a till, give it a name (for example Counter till) and get the 6-digit code. It works for 10 minutes.',
          'On the till, open Menu › This till › Connect this till.',
          'Type the code, then a manager PIN. The till needs internet for this step.',
          'The card now says "Connected as <name>". From now on everyone opens the till with their own PIN.',
        ],
        problems: [
          { problem: 'The code ran out.', fix: 'Add the till again in Tills for a new code.' },
          {
            problem: 'The till says "Disconnected in admin".',
            fix: 'It keeps selling with the PINs it has. Get a new code in Tills and connect again.',
          },
        ],
      },
      {
        heading: 'Install the till on the tablet',
        steps: [
          'Allow "Install unknown apps" for the browser or file manager, then install the Kennko POS APK.',
          'Open Kennko POS. On Connect this till, type the 6-digit code from admin › Tills, then a manager PIN.',
          'Accept the battery prompt and add Kennko POS to Never sleeping apps in Settings › Battery › Background usage limits.',
          'Keep the tablet on its charger.',
        ],
        tips: [
          'Sales live inside the app on the Samsung tablet and sync to Kennko when online.',
          'When an update is published, an Update banner appears at the top of the till.',
          'Use Menu › This till › Export backup to save or share a copy of the database.',
        ],
      },
      {
        heading: 'Set up the wall',
        steps: [
          'Install the Kennko Wall APK on the projector and open it once.',
          'Press OK on the big button once: sound starts and the board fills from the Samsung till automatically.',
          'Reboot the projector once to confirm Kennko Wall opens by itself.',
        ],
        tips: [
          'Reserve the Samsung tablet\'s IP address in the router as a fallback. You only need to enter it on the Wall hidden settings screen if automatic discovery fails.',
          'Keep the Samsung tablet awake and plugged in so the wall keeps receiving live orders.',
        ],
      },
    ],
  },
  {
    slug: 'opening-and-closing',
    title: 'Opening and closing the till',
    audience: ['Barista', 'Manager', 'Owner'],
    summary: 'Start a shift with the starting cash, move cash in and out, and close with a count.',
    sections: [
      {
        heading: 'Open the shift',
        steps: [
          'Type your PIN and tap Open the till.',
          'Go to Till. Count the cash in the drawer.',
          'Type that amount under Starting cash and tap Open the till.',
        ],
        tips: ['Tap Lock when you step away. The next person types their own PIN.'],
      },
      {
        heading: 'Cash in and cash out',
        steps: [
          'On Till, tap Cash in or Cash out.',
          'Type the amount and the reason.',
          'Cash out asks for a manager PIN.',
        ],
        tips: ['The Drawer card shows Expected in drawer. Check it against the drawer now and then.'],
      },
      {
        heading: 'Close the till',
        steps: [
          'Count all the cash in the drawer.',
          'On Till, tap Close the till and type the amount counted. Add a note if something is off.',
          'A manager types their PIN. Closing ends the shift and locks its numbers.',
          '"Till closed" shows Expected in drawer, Counted and Over / short. Tap Done.',
          'If you need a file of the day, tap Export today\'s sales.',
        ],
        tips: ['Always close the till at the end of the day, so the close reaches Kennko.'],
      },
      {
        heading: 'Who can do what',
        steps: [
          'Per-person PINs (the till is connected and the owner issued PINs): each person types their own 6-digit PIN. Voids, cash out, closing and menu update need an owner\'s or manager\'s own PIN.',
          'Shared PINs (not connected yet, or no manager or owner has a PIN): the staff PIN opens the till and the manager PIN approves voids, cash out and closing.',
          'In per-person mode your first name shows above Lock, and voids and cash moves say who did them.',
        ],
        problems: [
          {
            problem: 'A new PIN from admin does not work yet.',
            fix: 'Try again after a moment. The till checks with Kennko and it usually works by the next try.',
          },
          { problem: 'Wrong PIN.', fix: 'Type it again slowly. Forgotten? See Troubleshooting.' },
        ],
      },
    ],
  },
  {
    slug: 'counter-order',
    title: 'Taking an order at the counter',
    audience: ['Barista', 'Manager', 'Owner'],
    summary: 'Build the order, add a discount or Kennko card, take payment, print, and void when needed.',
    sections: [
      {
        heading: 'Build the order',
        steps: [
          'On Sell, tap a drink.',
          'Pick the Size and Ice (Regular ice, Less ice or No ice; Mixed in or Ice on the side). Hot drinks have no ice.',
          'Add any add-ons and a Note for the barista, then tap Add.',
          'In Current order, pick Dine in or Take out. Add the customer name if they want it (optional).',
          'Tap a line to change it, then tap Update. Use the minus and plus to change the quantity.',
        ],
        tips: ['A drink marked Sold out can\'t be tapped.'],
      },
      {
        heading: 'Discounts',
        steps: [
          'Tap Add a discount.',
          'Pick a one-tap discount such as Senior / PWD 20%, or take off an amount and tap Apply.',
          'To undo it, tap Remove discount.',
        ],
        tips: ['Check the Senior Citizen or PWD ID before you give that discount.'],
      },
      {
        heading: 'Take payment',
        steps: [
          'Tap Charge. Payment shows the Total due.',
          'Cash: tap an amount or Exact, or type the Cash received. The Change shows.',
          'GCash: check the customer\'s GCash confirmation, type the last digits of the reference (optional).',
          'Tap Confirm payment. The order number shows.',
          'Tap Print for a receipt, Stamp card if they have a Kennko card, then New order.',
        ],
        tips: ['Call the order by the number on the screen. The wall shows the same number.'],
      },
      {
        heading: 'Voids and refunds',
        steps: [
          'Open History and tap the order.',
          'Tap Void and say why (for example "Wrong drink").',
          'Tap Void order. A manager types their PIN.',
          'If the customer paid, give their money back the way they paid.',
        ],
        tips: [
          'A void takes the sale out of the totals and takes back its stamp and points.',
          'Online orders are never voided on the till. The owner cancels them in admin.',
        ],
        problems: [
          { problem: '"The sale was not saved."', fix: 'Tap Confirm payment again. Nothing was charged on the till.' },
        ],
      },
    ],
  },
  {
    slug: 'order-queue',
    title: 'The order queue and prep',
    audience: ['Barista', 'Manager', 'Owner'],
    summary: 'Move orders from Queued to Done on the Orders screen. The wall calls each number.',
    sections: [
      {
        heading: 'Work the queue',
        steps: [
          'Open Orders. Each paid order starts in Queued.',
          'Tap Start when you begin a drink. It moves to Preparing.',
          'Tap Ready when it is made. It moves to Serving and the wall calls it.',
          'Tap Done when the customer has it.',
          'Tapped too early? Tap Back to undo a step (counter orders only).',
        ],
        tips: [
          'Every tablet follows the same queue live.',
          'Each card shows how long the order has waited.',
        ],
      },
      {
        heading: 'Online orders on the board',
        steps: [
          'Website orders show as W1, W2… with an amber Online tag, once their payment is confirmed.',
          'Tap Start, then Ready (pickup) or Out for delivery (delivery), then Picked up or Delivered.',
          'The customer is told at each step.',
        ],
        tips: [
          'There is no Back and no Void on online tickets. The customer has already been told.',
          'Delivery tickets show the address, barangay and phone. Pickup tickets show no phone.',
        ],
      },
      {
        heading: 'What the wall shows',
        steps: [
          'A paid order joins In line and a customer cat walks in.',
          'Start moves it to Now preparing.',
          'Ready rings a bell, shows "Order 4 for Dana is ready!" and moves it to Now serving.',
          'Done takes the number off. A void takes it off too.',
        ],
        tips: [
          'The number is the one on the receipt. Online orders carry a W (W3 is not counter order 3).',
          'Delivery orders leave the wall when they go out. They are not called at the counter.',
        ],
      },
    ],
  },
  {
    slug: 'online-orders',
    title: 'Online orders and GCash checks',
    audience: ['Barista', 'Manager', 'Owner'],
    summary: 'Check each GCash payment in the GCash app, confirm or reject, then move the order along.',
    sections: [
      {
        heading: 'Check a payment',
        steps: [
          'Open Orders in admin. New orders wait under Needs checking.',
          'Read the GCash ref on the order. Tap View receipt to see the customer\'s screenshot.',
          'Open the GCash app and find that reference. Check the amount matches the Total.',
          'If it is there, tap Confirm payment. The customer gets their confirmation email now.',
          'If not, tap Reject, say why (the customer sees it) and tap Send rejection.',
        ],
        tips: [
          'A screenshot proves nothing. Only the GCash app shows the money arrived.',
          'Tap Turn on order alerts on the Overview screen to hear about new orders.',
        ],
        problems: [
          {
            problem: '"This reference is already used by another live order."',
            fix: 'Check both orders before confirming. One receipt cannot pay for two orders.',
          },
        ],
      },
      {
        heading: 'Move it along',
        steps: [
          'Pickup: Mark preparing, Mark ready for pickup, then Mark completed.',
          'Delivery: Mark preparing, Mark out for delivery, then Mark completed.',
          'The till\'s buttons do the same. Admin and the till follow each other within about 15 seconds.',
        ],
        tips: [
          'Nothing can be prepared before the payment is confirmed.',
          'Cancel order is owner only. It asks why and cannot be undone. Send any refund from the GCash app yourself.',
        ],
      },
      {
        heading: 'Delivery',
        steps: [
          'The order card shows the address and barangay.',
          'If the customer shared a pin, tap Navigate to pin for directions.',
          'If it says "No pin shared — call the customer for directions", call them.',
        ],
        tips: [
          'Delivery is free inside Villa Kananga. Elsewhere it is ₱20 for each started 4 km, worked out by Kennko.',
          'Everyone in a barangay pays the same fee.',
        ],
      },
      {
        heading: 'When online ordering is off',
        steps: [
          'Online ordering stays switched off until the real GCash QR is on the website.',
          'Julius switches it on (the NEXT_PUBLIC_ORDERING_ENABLED setting). There is no button in admin.',
        ],
      },
    ],
  },
  {
    slug: 'kennko-card',
    title: 'Kennko card, stamps and points',
    audience: ['Barista', 'Manager', 'Owner'],
    summary: 'Add the card to a sale, stamp it, give the free drink at 8 stamps, and handle paper cards.',
    sections: [
      {
        heading: 'Add the card and stamp it',
        steps: [
          'In the cart, tap Add Kennko card.',
          'Scan the QR on the customer\'s phone, or type the code (like KC-7F3-K9Q-XAM).',
          'After payment, tap Stamp card. You can also stamp from the ticket in Orders or from History.',
        ],
        tips: [
          'Never required. Skip is always one tap and a sale never waits for it.',
          'One stamp per sale. A sale of only the free drink earns none.',
          'The till shows stamps only, never the customer\'s name or points.',
        ],
        problems: [
          { problem: '"Check the code"', fix: 'A symbol is wrong. Read it again with the customer.' },
          {
            problem: '"No Kennko card has that code."',
            fix: 'Check it with the customer. They can show the QR instead.',
          },
          { problem: 'The camera does not open.', fix: 'Use the https address (port 4443). Typing always works.' },
        ],
      },
      {
        heading: 'The free drink (8 stamps)',
        steps: [
          'With a full card on the sale, the cart offers Make one drink free.',
          'Pick which drink is free. Its base price becomes ₱0; add-ons are still charged.',
          'Charging asks for a manager PIN. It needs the internet.',
        ],
        problems: [
          {
            problem: 'No internet, or the free drink can\'t be claimed.',
            fix: 'Nothing is saved. Charge the drink normally and give the free drink another day.',
          },
          {
            problem: '"No free drink waiting on this card."',
            fix: 'It was already used. A stuck claim comes back after 30 minutes.',
          },
        ],
      },
      {
        heading: 'Paper cards',
        steps: [
          'If the till says "Paper card: stamp their paper card", stamp their paper card by hand.',
          'That stamp also shows under Stamps to check on the Customers screen.',
        ],
      },
      {
        heading: 'Points',
        steps: [
          'Customers earn 1 point for every ₱10 spent. Discounts, the free drink and the delivery fee earn none.',
          'Online orders earn points when the payment is confirmed.',
          'Customers spend points on cosmetics for their cat.',
          'Owner only: adjust points on the customer\'s page in Customers.',
        ],
        tips: ['Online orders with a card show Stamp at pickup on their ticket.'],
      },
    ],
  },
  {
    slug: 'customers',
    title: 'Customers screen',
    audience: ['Manager', 'Owner'],
    summary: 'Look up a customer, switch paper and digital cards, apply stamps to check, hide a cat.',
    sections: [
      {
        heading: 'Look someone up',
        steps: [
          'Open Customers. Type a card code or name (at least 2 characters) and tap Search.',
          'Tap the customer to see their card, stamp cards, points and cat.',
        ],
      },
      {
        heading: 'Paper or digital card',
        steps: [
          'On the customer\'s page, tap Switch to paper card or Switch to digital card.',
          'Paper: stamps go on a paper card from now on. Online points still count.',
        ],
      },
      {
        heading: 'Stamps to check',
        steps: [
          'Stamps rung up for someone on a paper card wait under Stamps to check.',
          'Once they are on the digital card, tap Apply stamp. Otherwise tap Discard.',
        ],
        tips: ['Apply stamp stays greyed out while they are still on a paper card.'],
      },
      {
        heading: 'Adjust points (Owner only)',
        steps: [
          'On the customer\'s page, under Points, type the change (+50 or -20) and why.',
          'Tap Adjust points. The balance and the list update.',
        ],
      },
      {
        heading: 'Hide a cat',
        steps: [
          'Under Cat, tap Hide from the wall. The cat leaves the wall at the next sync.',
          'The customer sees "Kennko has paused your cat on the wall for now."',
          'Tap Show on the wall to undo it.',
        ],
      },
      {
        heading: 'Privacy',
        tips: [
          'Never read out or share a customer\'s email, phone, card code or points.',
          'Never send a GCash receipt screenshot anywhere. It carries the customer\'s name and GCash details.',
          'Customers delete their own account on My account. Staff can\'t do it for them.',
        ],
      },
    ],
  },
  {
    slug: 'cats-and-wall',
    title: 'Kennko cats and the wall check-in',
    audience: ['Barista', 'Manager', 'Owner'],
    summary: 'How customers bring their cat onto the wall, and how the owner runs the cosmetics shop.',
    sections: [
      {
        heading: 'What customers do',
        steps: [
          'On My account, they name their cat and dress it (Your cat), then tap Save my cat.',
          'They buy cosmetics with points in the shop on the same page.',
          'In the shop, they scan the QR in the bottom-right corner of the wall ("Scan to bring your cat in").',
          'On their phone they tap Walk my cat in. Their cat walks onto the wall within about 15 seconds.',
        ],
        tips: [
          'A visit lasts 90 minutes after the last check-in or linked counter order. Then the cat walks out.',
          'Up to 12 cats at once.',
          'Customers can turn off Show me on the wall themselves.',
        ],
        problems: [
          { problem: '"That code has changed"', fix: 'The QR changes every minute. Scan the wall again, not a photo.' },
          { problem: '"You need N more points"', fix: 'They need more points for that item.' },
          { problem: 'No QR on the wall.', fix: 'The till has not synced yet. See Troubleshooting.' },
        ],
      },
      {
        heading: 'Hide a cat (Manager or Owner)',
        steps: ['Customers › the customer › Cat › Hide from the wall.'],
      },
      {
        heading: 'Cosmetics screen (Owner only)',
        steps: [
          'Open Cosmetics.',
          'Change the Name, the Price (points) or the Order, or switch an item Off.',
          'Tap Save on that row.',
        ],
        tips: [
          'Starters are free for everyone and always on.',
          'A switched-off item stays with the people who own it.',
          'New items need new art in code, so they can\'t be added here.',
        ],
      },
    ],
  },
  {
    slug: 'menu-changes',
    title: 'Menu changes and sold-out items',
    audience: ['Barista', 'Manager', 'Owner'],
    summary: 'Mark drinks sold out at once; the owner edits, prices and photos, then publishes.',
    sections: [
      {
        heading: 'Mark something sold out',
        steps: [
          'On the till, open Menu and switch the drink off. In per-person mode it asks for Your PIN.',
          'Or in admin, open Menu and tap Mark sold out.',
          'When it is back, switch it on or tap Mark available.',
        ],
        tips: ['Sold out needs no Publish. The till and admin follow each other within about 15 seconds.'],
      },
      {
        heading: 'Edit the menu (Owner only)',
        steps: [
          'Open Menu in admin. Use Search items to find a drink.',
          'Change prices in the table, or open an item to edit its name, category, description and add-on groups.',
          'Add a Product photo from the item. Save a new item first, then reopen it to add a photo.',
          'Tap New item to add one. Archive takes one off (Restore brings it back).',
          'Tap Publish in the bar at the bottom.',
        ],
        tips: [
          'A connected till picks up the new menu at its next sync, about 15 seconds, with no PIN.',
          'A till that is not connected uses Update from website on its Menu screen, with a manager PIN.',
        ],
        problems: [
          { problem: '"Only the owner can change the menu."', fix: 'Ask the owner. Baristas and managers can only mark sold out.' },
          { problem: 'The till shows the old price.', fix: 'Check you tapped Publish, then tap Check now on the till\'s Menu screen.' },
        ],
      },
    ],
  },
  {
    slug: 'reports',
    title: 'Reports and Needs a look',
    audience: ['Manager', 'Owner'],
    summary: 'Read the day report, and (owner) clear the things the till could not send cleanly.',
    sections: [
      {
        heading: 'The day report (Manager or Owner)',
        steps: [
          'Open Reports. It shows today. Use Previous day and Next day to move.',
          'Sales and Payments show counter and online totals, cash and GCash.',
          'Cash by shift shows Float, Cash sales, In, Out, Expected, Counted and Over / short.',
          'Items, Cancelled and refunded, Flagged orders and held sales follow.',
        ],
        tips: [
          'The counter total should match the till\'s day summary.',
          'Held sales are not in the totals until the owner sorts them out.',
        ],
      },
      {
        heading: 'Needs a look (Owner only)',
        steps: [
          'Open Needs a look. A badge in the menu shows how many wait. Open and Resolved are tabs.',
          'Till records: tap Discard (say why) to set a held one aside, or Mark seen for a flagged one.',
          'Flagged orders: check them, then tap Mark seen.',
          'Till stuck? Tap Try again now: <till name> to retry its held records.',
        ],
      },
      {
        heading: 'Close a stuck shift (Owner only)',
        steps: [
          'Under Open shifts, find the one marked Blocking sync and tap Close this shift.',
          'Type the cash counted (0 if unknown) and a note saying why.',
          'Tap Close shift, then Yes, close it.',
        ],
        tips: [
          'Never replace or restore the till\'s sales file without closing the shift first.',
          'If the till\'s own close arrives later, it replaces the admin close.',
        ],
      },
    ],
  },
  {
    slug: 'internet-down',
    title: 'When the internet is down',
    audience: ['Barista', 'Manager', 'Owner'],
    summary: 'The till keeps selling. Here is what waits for the internet and what does not.',
    sections: [
      {
        heading: 'Keeps working',
        steps: [
          'Selling, cash, GCash (check the customer\'s confirmation as usual), receipts and the Orders queue.',
          'Opening, cash in and out, and closing the till. PINs work from the list the till already has.',
          'Adding a Kennko card ("Will confirm when back online") and stamping. They are sent later.',
          'Online orders already on the board, and their buttons.',
          'The wall: cats already in stay until their visit ends, and the QR keeps changing.',
        ],
      },
      {
        heading: 'Waits for the internet',
        steps: [
          'The free drink. Charge the drink normally instead.',
          'New online orders arriving, and new wall check-ins (phones check in over their own data).',
          'New PINs and menu changes from admin. Connecting a till.',
        ],
        tips: [
          'The amber Offline badge says how much is waiting, like "Offline: 12 sales waiting to send". Keep selling.',
          'Everything waits in order and sends by itself when the internet is back.',
        ],
      },
      {
        heading: 'Keep the router on',
        tips: [
          'The tablets and the projector reach the till over the shop wifi, not the internet.',
          'If the router is off, other tablets and the wall can\'t reach the till. Only the counter tablet keeps working.',
          'Keep the counter tablet plugged in and awake.',
        ],
      },
    ],
  },
  {
    slug: 'troubleshooting',
    title: 'Troubleshooting',
    audience: ['Barista', 'Manager', 'Owner'],
    summary: 'Quick fixes for the common problems at the counter and in admin.',
    sections: [
      {
        heading: 'First checks',
        steps: [
          'Keep selling. Sales are saved on the till even when something else is wrong.',
          'Check the counter tablet is on, awake, plugged in and on the shop wifi.',
          'Check the router is on.',
          'Read the message on the screen and find it below.',
          'Still stuck? Tell the owner what the screen says.',
        ],
      },
      {
        heading: 'Till and tablets',
        problems: [
          {
            problem: 'Offline badge',
            fix: 'The internet is down or slow. Keep selling; it sends when it is back. Check the router.',
          },
          {
            problem: '"Sync problem: …"',
            fix: 'Kennko refused something. Keep selling and tell the owner. Check Needs a look in admin.',
          },
          {
            problem: '"This device\'s clock is N minutes behind."',
            fix: 'Sales still work. Fix the time in Android settings so reports and QR codes line up.',
          },
          {
            problem: 'PIN forgotten',
            fix: 'The owner taps New PIN on the Staff screen and gives the new one. The till picks it up within a moment.',
          },
        ],
      },
      {
        heading: 'Wall',
        problems: [
          {
            problem: 'No QR on the wall',
            fix: 'The till must have synced at least once and be connected. Check Tills in admin and the till\'s Menu screen.',
          },
          {
            problem: 'A fresh QR never works on phones',
            fix: 'Check the Samsung tablet\'s clock in Android settings.',
          },
          {
            problem: 'Old orders or "can\'t reach the till"',
            fix: 'The Samsung tablet is asleep or off the wifi. Open the Wall hidden settings screen (Menu button) to retry or check the till address.',
          },
          { problem: 'No sound', fix: 'Press OK on the big button on the wall once.' },
        ],
      },
      {
        heading: 'Website and admin',
        problems: [
          {
            problem: 'A customer can\'t sign in',
            fix: 'Ask them to try the email link instead of Google, and check their spam folder. They can always order as a guest.',
          },
          {
            problem: 'Wrong price on the website or the till',
            fix: 'The owner fixes it in Menu and taps Publish. The till follows at its next sync.',
          },
          {
            problem: 'A screen says "Couldn\'t load … Refresh to try again."',
            fix: 'Refresh the page. If it keeps happening, tell Julius.',
          },
        ],
      },
    ],
  },
]

export function findTopic(slug: string): GuideTopic | undefined {
  return TOPICS.find((t) => t.slug === slug)
}

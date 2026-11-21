/**
 * Day-to-day "how do I…?" questions for /admin/guide/faq. Plain text; `topic` links to the full guide page.
 * Only what the till and admin actually do: check the screens' code before adding an answer.
 */

export type FaqItem = {
  /** Anchor on the FAQ page. */
  id: string
  question: string
  answer: string
  /** Slug of the guide topic with the full steps. */
  topic?: string
}

export type FaqGroup = { title: string; items: FaqItem[] }

export const FAQ: FaqGroup[] = [
  {
    title: 'Orders and payments',
    items: [
      {
        id: 'reused-reference',
        question: 'A GCash reference looks reused. What do I do?',
        answer:
          'Admin shows "This reference is already used by another live order." Open the GCash app and find that reference. One receipt pays for one order: confirm the order it really paid for and tap Reject on the other, saying why.',
        topic: 'online-orders',
      },
      {
        id: 'payment-not-found',
        question: 'I can\'t find the payment in the GCash app.',
        answer:
          'Don\'t confirm it. Tap Reject, say why (the customer sees it) and tap Send rejection. A screenshot alone proves nothing.',
        topic: 'online-orders',
      },
      {
        id: 'cancel-online',
        question: 'How do I cancel or refund an online order?',
        answer:
          'Owner only: on the order in admin Orders, tap Cancel order and say why. It cannot be undone. Send the money back yourself in the GCash app; nothing in admin moves money. It leaves the till and the wall at the next sync.',
        topic: 'online-orders',
      },
      {
        id: 'void-counter',
        question: 'How do I void a counter sale?',
        answer: 'On the till, open History, tap the order, tap Void, say why, then Void order. A manager types their PIN.',
        topic: 'counter-order',
      },
    ],
  },
  {
    title: 'Menu and prices',
    items: [
      {
        id: 'ran-out',
        question: 'A drink ran out mid-day.',
        answer:
          'Switch it off on the till\'s Menu screen, or tap Mark sold out in admin Menu. No Publish needed. Switch it back on when it is in again.',
        topic: 'menu-changes',
      },
      {
        id: 'change-price',
        question: 'How do I change a price?',
        answer:
          'Owner only: change it in admin Menu, then tap Publish in the bar at the bottom. A connected till picks it up within about 15 seconds.',
        topic: 'menu-changes',
      },
    ],
  },
  {
    title: 'Staff and PINs',
    items: [
      {
        id: 'new-barista',
        question: 'How do I add a new barista and give them a PIN?',
        answer:
          'Owner only: in Staff, under Add someone, type their name, pick Barista and tap Add (no email needed). Then tap Set PIN in their row and give them the PIN. It is shown only once.',
        topic: 'first-time-setup',
      },
      {
        id: 'forgot-pin',
        question: 'Someone forgot their till PIN.',
        answer: 'Owner only: in Staff, tap New PIN in their row and give them the new one. The old PIN stops working.',
        topic: 'troubleshooting',
      },
      {
        id: 'staff-left',
        question: 'Someone left the shop.',
        answer:
          'Owner only: in Staff, tap Deactivate in their row. Their PIN drops off the till at the next sync. Reactivate brings them back.',
        topic: 'first-time-setup',
      },
    ],
  },
  {
    title: 'Customers, stamps and points',
    items: [
      {
        id: 'stamp-later',
        question: 'A customer wants their stamp added after the sale.',
        answer:
          'On the till, while it is still open, go to History, tap the sale, Add customer with their card, then Stamp card. There is no way to add a stamp in admin.',
        topic: 'kennko-card',
      },
      {
        id: 'add-points',
        question: 'How do I add points to a customer?',
        answer:
          'Owner only: open Customers, find them, and under Points type the change (like +50) and why. Tap Adjust points.',
        topic: 'customers',
      },
      {
        id: 'paper-to-digital',
        question: 'How do I switch a customer from paper to digital?',
        answer:
          'Manager or owner: on their page in Customers, tap Switch to digital card. Then apply any waiting stamps under Stamps to check with Apply stamp.',
        topic: 'customers',
      },
      {
        id: 'free-drink-offline',
        question: 'The free drink won\'t go through.',
        answer: 'It needs the internet and a manager PIN. If it fails, nothing is saved: charge the drink normally.',
        topic: 'kennko-card',
      },
    ],
  },
  {
    title: 'Cats and cosmetics',
    items: [
      {
        id: 'bad-cat-name',
        question: 'A cat has a rude name on the wall.',
        answer:
          'Manager or owner: in Customers, open the customer and tap Hide from the wall. Admin can\'t rename a cat; the customer renames it on My account. Tap Show on the wall to bring it back.',
        topic: 'customers',
      },
      {
        id: 'cosmetic-price',
        question: 'How do I reprice or retire a cosmetic?',
        answer:
          'Owner only: open Cosmetics, change the Price (points) or switch it Off, then tap Save. Starters stay free and on. People who own a switched-off item keep it.',
        topic: 'cats-and-wall',
      },
    ],
  },
  {
    title: 'Tills and wall',
    items: [
      {
        id: 'reconnect-till',
        question: 'The till says "Disconnected in admin". How do I reconnect it?',
        answer:
          'Owner: in Tills, add the till to get a new 6-digit code. On the till, open Menu › This till › Connect this till, type the code and a manager PIN. It keeps selling meanwhile.',
        topic: 'first-time-setup',
      },
      {
        id: 'no-qr',
        question: 'The wall shows no QR.',
        answer:
          'The till must be connected and have synced at least once. Check Tills in admin and the till\'s Menu screen. With the internet down, a till that synced before keeps showing it.',
        topic: 'troubleshooting',
      },
    ],
  },
  {
    title: 'Reports and Needs a look',
    items: [
      {
        id: 'todays-sales',
        question: 'Where do I see today\'s sales?',
        answer:
          'On the till\'s Till screen (this shift), or in admin Reports for the whole day, counter and online (manager or owner).',
        topic: 'reports',
      },
      {
        id: 'stuck-shift',
        question: 'The till\'s sales are stuck behind an old shift.',
        answer:
          'Owner only: in Needs a look, under Open shifts, tap Close this shift, type the cash counted and a note, then Close shift and Yes, close it.',
        topic: 'reports',
      },
    ],
  },
  {
    title: 'Accounts and sign-in',
    items: [
      {
        id: 'delete-account',
        question: 'A customer wants their account deleted.',
        answer:
          'They do it themselves: on My account, Delete account, type DELETE and confirm. Staff can\'t delete it for them.',
        topic: 'customers',
      },
      {
        id: 'admin-password',
        question: 'How do I set or change my admin password?',
        answer:
          'Signed in, tap Set a password under your name, type it twice and tap Set password. Forgotten it? There is no reset link on the sign-in page; ask Julius.',
        topic: 'first-time-setup',
      },
    ],
  },
]

export const FAQ_ITEMS: FaqItem[] = FAQ.flatMap((g) => g.items)

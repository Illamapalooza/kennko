import { afterAll, beforeAll, expect, test } from 'vitest'
import { startTestDb, type TestDb } from './pg.js'

const OWNER = '11111111-1111-4111-8111-111111111111'

let db: TestDb
beforeAll(async () => {
  db = await startTestDb()
  await db.sql`insert into auth.users (id, email, email_confirmed_at) values (${OWNER}, 'owner@kennko.test', now())`
  await db.sql`insert into staff (id, user_id, email, full_name, role) values (${OWNER}, ${OWNER}, 'owner@kennko.test', 'Olive', 'owner')`
})
afterAll(async () => {
  await db.stop()
})

const insertOrder = async () => {
  const [row] = await db.sql`
    insert into orders (channel, fulfilment, business_day, ticket_series, ticket_number, customer_name,
      prep_status, payment_status, subtotal_centavos, discount_centavos, delivery_fee_centavos, total_centavos)
    values ('counter', 'dine_in', '2026-11-20', 'C', ${Math.floor(Math.random() * 1e6) + 1}, 'Walk-in',
      'placed', 'unpaid', 10000, 0, 0, 10000)
    returning id`
  return row.id as string
}

const insertSub = async (endpoint: string) => {
  const [row] = await db.sql`
    insert into push_subscriptions (endpoint, p256dh, auth, kind) values (${endpoint}, 'k', 'a', 'customer')
    returning id`
  return row.id as string
}

test('shop_settings is seeded with one Kennko row and no registered name or TIN', async () => {
  const rows = await db.sql`select * from shop_settings`
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({
    id: 1,
    display_name: 'Kennko Coffee',
    registered_name: null,
    tin: null,
    address: 'CT. Montalban St., Villa Kananga, Butuan City, Philippines 8600',
    phone: '0930 599 2729',
    facebook_url: 'https://www.facebook.com/kennco.cafebxu',
    receipt_footer: 'Ask for your official receipt at the counter.',
  })
})

test('a second shop_settings row fails the id = 1 check', async () => {
  await expect(
    db.sql`insert into shop_settings (id, display_name, address) values (2, 'Other', 'Elsewhere')`,
  ).rejects.toThrow(/check/)
})

test('a staff subscription needs a staff_id', async () => {
  await expect(
    db.sql`insert into push_subscriptions (endpoint, p256dh, auth, kind) values ('https://push.test/staff-none', 'k', 'a', 'staff')`,
  ).rejects.toThrow(/check/)
  await db.sql`insert into push_subscriptions (endpoint, p256dh, auth, kind, staff_id)
    values ('https://push.test/staff-ok', 'k', 'a', 'staff', ${OWNER})`
})

test('a customer subscription cannot carry a staff_id', async () => {
  await expect(
    db.sql`insert into push_subscriptions (endpoint, p256dh, auth, kind, staff_id)
      values ('https://push.test/cust-staff', 'k', 'a', 'customer', ${OWNER})`,
  ).rejects.toThrow(/check/)
})

test('a duplicate endpoint fails', async () => {
  await insertSub('https://push.test/dup')
  await expect(insertSub('https://push.test/dup')).rejects.toThrow(/unique|duplicate/)
})

test('deleting an order deletes its watch rows', async () => {
  const orderId = await insertOrder()
  const subId = await insertSub('https://push.test/watch')
  await db.sql`insert into push_order_watch (order_id, subscription_id) values (${orderId}, ${subId})`
  await db.sql`delete from orders where id = ${orderId}`
  expect(await db.sql`select 1 from push_order_watch where subscription_id = ${subId}`).toHaveLength(0)
})

test('anon and authenticated hold no privilege on the push tables', async () => {
  const privs = await db.sql`
    select r.role, t.tbl, p.priv
    from (values ('anon'), ('authenticated')) r(role),
         (values ('push_subscriptions'), ('push_order_watch')) t(tbl),
         (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) p(priv)
    where has_table_privilege(r.role, t.tbl, p.priv)`
  expect(privs).toHaveLength(0)
})

test('anon holds no privilege on shop_settings and authenticated only SELECT', async () => {
  const privs = await db.sql`
    select r.role, p.priv
    from (values ('anon'), ('authenticated')) r(role),
         (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) p(priv)
    where has_table_privilege(r.role, 'shop_settings', p.priv)`
  expect(privs.map((x) => `${x.role}:${x.priv}`)).toEqual(['authenticated:SELECT'])
})

test('kennko_api can insert a subscription and a watch and read shop settings', async () => {
  const orderId = await insertOrder()
  await db.sql.begin(async (tx) => {
    await tx.unsafe('set local role kennko_api')
    const [s] = await tx`select display_name from shop_settings`
    expect(s.display_name).toBe('Kennko Coffee')
    const [sub] = await tx`
      insert into push_subscriptions (endpoint, p256dh, auth, kind) values ('https://push.test/api', 'k', 'a', 'customer')
      returning id`
    await tx`insert into push_order_watch (order_id, subscription_id) values (${orderId}, ${sub.id})`
    await tx`update push_subscriptions set last_used_at = now() where id = ${sub.id}`
    await tx`delete from push_order_watch where subscription_id = ${sub.id}`
  })
})

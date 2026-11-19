import { expect, test } from 'vitest'
import { asUser, startTestDb } from './pg.ts'

test('every migration applies to a fresh database', async () => {
  const db = await startTestDb()
  try {
    const [{ count }] = await db.sql`select count(*)::int from menu_categories`
    expect(count).toBe(1) // the seeded Food category
  } finally {
    await db.stop()
  }
})

test('anon can read a live menu item and not an archived one', async () => {
  const db = await startTestDb()
  try {
    const [cat] = await db.sql`insert into menu_categories (name) values ('Coffee') returning id`
    await db.sql`insert into menu_items (category_id, name, is_archived)
      values (${cat.id}, 'Latte', false), (${cat.id}, 'Old Latte', true)`
    const rows = await asUser(db.sql, null, (tx) => tx`select name from menu_items where name in ('Latte', 'Old Latte') order by name`)
    expect(rows.map((r) => r.name)).toEqual(['Latte'])
  } finally {
    await db.stop()
  }
})

test('asUser sets uid and role inside the transaction only', async () => {
  const db = await startTestDb()
  try {
    const id = '11111111-1111-4111-8111-111111111111'
    const [inside] = await asUser(db.sql, id, (tx) => tx`select auth.uid()::text as uid, auth.role() as role`)
    expect(inside).toEqual({ uid: id, role: 'authenticated' })
    const [after] = await db.sql`select auth.uid() as uid, auth.role() as role, current_user as usr`
    expect(after.uid).toBeNull()
    expect(after.role).toBeNull()
    expect(after.usr).toBe('postgres')
  } finally {
    await db.stop()
  }
})

import { expect, test } from 'vitest'
import { asUser, startTestDb } from './pg.ts'

test('every migration applies to a fresh database', async () => {
  const db = await startTestDb()
  try {
    const [{ count }] = await db.sql`select count(*)::int from menu_categories`
    expect(count).toBe(0)
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
    const rows = await asUser(db.sql, null, (tx) => tx`select name from menu_items order by name`)
    expect(rows.map((r) => r.name)).toEqual(['Latte'])
  } finally {
    await db.stop()
  }
})

package coffee.kennko.kit

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class SqliteBridgeTest {
    @get:Rule
    val tmp = TemporaryFolder()

    private fun call(bridge: SqliteBridge, op: String, block: JSONObject.() -> Unit): JSONObject {
        val req = JSONObject().put("op", op)
        req.block()
        return JSONObject(bridge.call(req.toString()))
    }

    private fun openDb(bridge: SqliteBridge, name: String): Int {
        val res = call(bridge, "open") { put("file", name) }
        assertFalse("unexpected open error: $res", res.has("error"))
        return res.getInt("db")
    }

    @Test
    fun `opens and round-trips types`() {
        val bridge = SqliteBridge(tmp.root)
        val db = openDb(bridge, "a.db")
        call(bridge, "exec") {
            put("db", db)
            put("sql", "create table t (id integer primary key autoincrement, ts integer, note text, txt text)")
        }
        call(bridge, "run") {
            put("db", db)
            put("sql", "insert into t (ts, note, txt) values (?, ?, ?)")
            put("params", JSONArray().put(1732233600123L).put(JSONObject.NULL).put("Ñoño ☕🐈"))
        }
        val got = call(bridge, "get") {
            put("db", db)
            put("sql", "select ts, note, txt from t where id = ?")
            put("params", JSONArray().put(1))
        }
        val row = got.getJSONObject("row")
        assertEquals(1732233600123L, row.getLong("ts"))
        assertTrue(row.isNull("note"))
        assertEquals("Ñoño ☕🐈", row.getString("txt"))
        call(bridge, "close") { put("db", db) }
    }

    @Test
    fun `run reports changes and rowid`() {
        val bridge = SqliteBridge(tmp.root)
        val db = openDb(bridge, "b.db")
        call(bridge, "exec") {
            put("db", db)
            put("sql", "create table t (id integer primary key autoincrement, v text)")
        }
        val r1 = call(bridge, "run") {
            put("db", db)
            put("sql", "insert into t (v) values (?)")
            put("params", JSONArray().put("a"))
        }
        assertEquals(1, r1.getInt("changes"))
        assertEquals(1L, r1.getLong("lastInsertRowid"))

        val r2 = call(bridge, "run") {
            put("db", db)
            put("sql", "insert into t (v) values (?)")
            put("params", JSONArray().put("b"))
        }
        assertEquals(2L, r2.getLong("lastInsertRowid"))

        val u0 = call(bridge, "run") {
            put("db", db)
            put("sql", "update t set v = ? where id = ?")
            put("params", JSONArray().put("z").put(999))
        }
        assertEquals(0, u0.getInt("changes"))
        call(bridge, "close") { put("db", db) }
    }

    @Test
    fun `unique violation keeps the SQLite message`() {
        val bridge = SqliteBridge(tmp.root)
        val db = openDb(bridge, "c.db")
        call(bridge, "exec") {
            put("db", db)
            put("sql", "create table u (k text primary key)")
        }
        call(bridge, "run") {
            put("db", db)
            put("sql", "insert into u (k) values (?)")
            put("params", JSONArray().put("dup"))
        }
        val err = call(bridge, "run") {
            put("db", db)
            put("sql", "insert into u (k) values (?)")
            put("params", JSONArray().put("dup"))
        }
        assertTrue("expected UNIQUE constraint failed in $err", err.getString("error").contains("UNIQUE constraint failed"))
        call(bridge, "close") { put("db", db) }
    }

    @Test
    fun `transaction rollback leaves nothing`() {
        val bridge = SqliteBridge(tmp.root)
        val db = openDb(bridge, "d.db")
        call(bridge, "exec") {
            put("db", db)
            put("sql", "create table tx (k text)")
        }
        call(bridge, "exec") { put("db", db); put("sql", "begin immediate") }
        call(bridge, "run") { put("db", db); put("sql", "insert into tx (k) values (?)"); put("params", JSONArray().put("v")) }
        call(bridge, "exec") { put("db", db); put("sql", "rollback") }
        val got = call(bridge, "get") { put("db", db); put("sql", "select k from tx") }
        assertTrue(got.isNull("row"))
        call(bridge, "close") { put("db", db) }
    }

    @Test
    fun `refuses a path outside root`() {
        val bridge = SqliteBridge(tmp.root)
        val res = call(bridge, "open") { put("file", "/etc/x.db") }
        assertTrue(res.has("error"))
    }

    @Test
    fun `vacuum into makes a copy`() {
        val bridge = SqliteBridge(tmp.root)
        val db = openDb(bridge, "src.db")
        call(bridge, "exec") {
            put("db", db)
            put("sql", "create table items (name text); insert into items values ('latte')")
        }
        val copyFile = File(tmp.root, "copy.db").absolutePath
        val vac = call(bridge, "run") {
            put("db", db)
            put("sql", "vacuum into ?")
            put("params", JSONArray().put(copyFile))
        }
        assertFalse("unexpected vacuum error: $vac", vac.has("error"))

        val copyDb = openDb(bridge, "copy.db")
        val got = call(bridge, "get") { put("db", copyDb); put("sql", "select name from items") }
        assertEquals("latte", got.getJSONObject("row").getString("name"))
        call(bridge, "close") { put("db", copyDb) }
        call(bridge, "close") { put("db", db) }
    }

    @Test
    fun `blob column is refused`() {
        val bridge = SqliteBridge(tmp.root)
        val db = openDb(bridge, "blob.db")
        call(bridge, "exec") {
            put("db", db)
            put("sql", "create table b (x blob); insert into b values (X'0102')")
        }
        val got = call(bridge, "get") { put("db", db); put("sql", "select x from b") }
        assertTrue(got.has("error"))
        call(bridge, "close") { put("db", db) }
    }
}

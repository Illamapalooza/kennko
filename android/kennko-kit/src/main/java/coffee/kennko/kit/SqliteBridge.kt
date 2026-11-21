package coffee.kennko.kit

import androidx.sqlite.SQLiteConnection
import androidx.sqlite.SQLiteStatement
import androidx.sqlite.driver.bundled.BundledSQLiteDriver
import androidx.sqlite.execSQL
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.concurrent.atomic.AtomicInteger

class SqliteBridge(private val root: File) {
    private val driver = BundledSQLiteDriver()
    private val nextId = AtomicInteger(1)
    private val conns = HashMap<Int, Conn>()
    private val rootCanonical = root.canonicalFile

    private class Conn(val db: SQLiteConnection) {
        val cache = object : LinkedHashMap<String, SQLiteStatement>(64, 0.75f, true) {
            override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, SQLiteStatement>): Boolean {
                if (size > 64) {
                    try { eldest.value.close() } catch (_: Exception) {}
                    return true
                }
                return false
            }
        }

        fun prepare(sql: String): SQLiteStatement {
            cache[sql]?.let { return it }
            val stmt = db.prepare(sql)
            cache[sql] = stmt
            return stmt
        }

        fun closeAll() {
            for (stmt in cache.values) {
                try { stmt.close() } catch (_: Exception) {}
            }
            cache.clear()
            db.close()
        }
    }

    @Synchronized
    fun call(requestJson: String): String {
        return try {
            val req = JSONObject(requestJson)
            when (val op = req.optString("op")) {
                "open" -> opOpen(req)
                "exec" -> opExec(req)
                "run" -> opRun(req)
                "get" -> opGet(req)
                "all" -> opAll(req)
                "close" -> opClose(req)
                else -> errorJson("Unknown op: $op")
            }
        } catch (t: Throwable) {
            errorJson(t.message ?: t.javaClass.simpleName)
        }
    }

    private fun resolveInsideRoot(fileArg: String): File {
        if (fileArg.isBlank()) throw IllegalArgumentException("Empty database path")
        val f = File(fileArg)
        val target = (if (f.isAbsolute) f else File(rootCanonical, fileArg)).canonicalFile
        val rootPath = rootCanonical.path
        val targetPath = target.path
        if (targetPath != rootPath && !targetPath.startsWith(rootPath + File.separator)) {
            throw SecurityException("Database path outside root: $fileArg")
        }
        return target
    }

    private fun opOpen(req: JSONObject): String {
        val fileArg = req.getString("file")
        val target = resolveInsideRoot(fileArg)
        target.parentFile?.mkdirs()
        val db = driver.open(target.path)
        val id = nextId.getAndIncrement()
        conns[id] = Conn(db)
        return JSONObject().put("db", id).toString()
    }

    private fun requireConn(req: JSONObject): Conn {
        val id = req.getInt("db")
        return conns[id] ?: throw IllegalStateException("Database $id is not open")
    }

    private fun splitStatements(sql: String): List<String> {
        val out = ArrayList<String>()
        val cur = StringBuilder()
        var i = 0
        var inSingle = false
        var inDouble = false
        var inLineComment = false
        var inBlockComment = false
        while (i < sql.length) {
            val c = sql[i]
            val next = if (i + 1 < sql.length) sql[i + 1] else '\u0000'
            when {
                inLineComment -> {
                    cur.append(c)
                    if (c == '\n') inLineComment = false
                }
                inBlockComment -> {
                    cur.append(c)
                    if (c == '*' && next == '/') {
                        cur.append(next)
                        i++
                        inBlockComment = false
                    }
                }
                inSingle -> {
                    cur.append(c)
                    if (c == '\'' && next == '\'') {
                        cur.append(next)
                        i++
                    } else if (c == '\'') {
                        inSingle = false
                    }
                }
                inDouble -> {
                    cur.append(c)
                    if (c == '"' && next == '"') {
                        cur.append(next)
                        i++
                    } else if (c == '"') {
                        inDouble = false
                    }
                }
                c == '-' && next == '-' -> {
                    cur.append(c).append(next)
                    i++
                    inLineComment = true
                }
                c == '/' && next == '*' -> {
                    cur.append(c).append(next)
                    i++
                    inBlockComment = true
                }
                c == '\'' -> {
                    cur.append(c)
                    inSingle = true
                }
                c == '"' -> {
                    cur.append(c)
                    inDouble = true
                }
                c == ';' -> {
                    val s = cur.toString().trim()
                    if (s.isNotEmpty()) out.add(s)
                    cur.setLength(0)
                }
                else -> cur.append(c)
            }
            i++
        }
        val tail = cur.toString().trim()
        if (tail.isNotEmpty()) out.add(tail)
        return out
    }

    private fun opExec(req: JSONObject): String {
        val conn = requireConn(req)
        val sql = req.getString("sql")
        for (stmt in splitStatements(sql)) {
            conn.db.execSQL(stmt)
        }
        return "{}"
    }

    private fun bindParams(stmt: SQLiteStatement, params: JSONArray?) {
        if (params == null) return
        for (i in 0 until params.length()) {
            val idx = i + 1
            val v = params.get(i)
            when {
                v === JSONObject.NULL -> stmt.bindNull(idx)
                v is Boolean -> stmt.bindLong(idx, if (v) 1L else 0L)
                v is Int -> stmt.bindLong(idx, v.toLong())
                v is Long -> stmt.bindLong(idx, v)
                v is Number -> {
                    val d = v.toDouble()
                    if (d % 1.0 == 0.0 && d >= Long.MIN_VALUE.toDouble() && d <= Long.MAX_VALUE.toDouble()) {
                        stmt.bindLong(idx, v.toLong())
                    } else {
                        stmt.bindDouble(idx, d)
                    }
                }
                v is String -> stmt.bindText(idx, v)
                else -> throw IllegalArgumentException("Unsupported param type: ${v.javaClass.simpleName}")
            }
        }
    }

    private fun readRow(stmt: SQLiteStatement): JSONObject {
        val obj = JSONObject()
        val count = stmt.getColumnCount()
        for (i in 0 until count) {
            val name = stmt.getColumnName(i)
            if (stmt.isNull(i)) {
                obj.put(name, JSONObject.NULL)
                continue
            }
            when (stmt.getColumnType(i)) {
                1 -> obj.put(name, stmt.getLong(i)) // SQLITE_INTEGER
                2 -> obj.put(name, stmt.getDouble(i)) // SQLITE_FLOAT
                3 -> obj.put(name, stmt.getText(i)) // SQLITE_TEXT
                4 -> throw IllegalStateException("BLOB column is not supported ($name)") // SQLITE_BLOB
                5 -> obj.put(name, JSONObject.NULL) // SQLITE_NULL
                else -> obj.put(name, stmt.getText(i))
            }
        }
        return obj
    }

    private fun opRun(req: JSONObject): String {
        val conn = requireConn(req)
        val sql = req.getString("sql")
        val params = req.optJSONArray("params")
        val stmt = conn.prepare(sql)
        try {
            stmt.reset()
            stmt.clearBindings()
            bindParams(stmt, params)
            stmt.step()
        } finally {
            stmt.reset()
            stmt.clearBindings()
        }
        val meta = conn.prepare("select changes(), last_insert_rowid()")
        val changes: Long
        val rowid: Long
        try {
            meta.reset()
            meta.step()
            changes = meta.getLong(0)
            rowid = meta.getLong(1)
        } finally {
            meta.reset()
        }
        return JSONObject()
            .put("changes", changes)
            .put("lastInsertRowid", rowid)
            .toString()
    }

    private fun opGet(req: JSONObject): String {
        val conn = requireConn(req)
        val sql = req.getString("sql")
        val params = req.optJSONArray("params")
        val stmt = conn.prepare(sql)
        val row: Any = try {
            stmt.reset()
            stmt.clearBindings()
            bindParams(stmt, params)
            if (stmt.step()) readRow(stmt) else JSONObject.NULL
        } finally {
            stmt.reset()
            stmt.clearBindings()
        }
        return JSONObject().put("row", row).toString()
    }

    private fun opAll(req: JSONObject): String {
        val conn = requireConn(req)
        val sql = req.getString("sql")
        val params = req.optJSONArray("params")
        val stmt = conn.prepare(sql)
        val rows = JSONArray()
        try {
            stmt.reset()
            stmt.clearBindings()
            bindParams(stmt, params)
            while (stmt.step()) {
                rows.put(readRow(stmt))
            }
        } finally {
            stmt.reset()
            stmt.clearBindings()
        }
        return JSONObject().put("rows", rows).toString()
    }

    private fun opClose(req: JSONObject): String {
        val id = req.getInt("db")
        conns.remove(id)?.closeAll()
        return "{}"
    }

    private fun errorJson(msg: String): String {
        return JSONObject().put("error", msg).toString()
    }
}

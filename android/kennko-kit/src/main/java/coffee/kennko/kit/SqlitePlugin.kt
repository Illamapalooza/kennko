package coffee.kennko.kit

import android.webkit.JavascriptInterface
import com.getcapacitor.Plugin
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.File

@CapacitorPlugin(name = "KennkoSqlitePlugin")
class SqlitePlugin : Plugin() {
    override fun load() {
        val root = context.filesDir.parentFile!!
        val js = Js(SqliteBridge(root), context.filesDir)
        bridge.webView.addJavascriptInterface(js, "KennkoSqlite")
    }

    class Js(
        private val sqlite: SqliteBridge,
        private val filesDir: File,
    ) {
        @JavascriptInterface
        fun call(json: String): String = sqlite.call(json)

        @JavascriptInterface
        fun backupPath(day: String): String {
            if (!Regex("^\\d{4}-\\d{2}-\\d{2}$").matches(day)) {
                throw IllegalArgumentException("Invalid day: $day")
            }
            val dir = File(filesDir, "backups").apply { mkdirs() }
            val target = File(dir, "pos-$day.db")
            if (target.exists()) target.delete()
            val existing = dir.listFiles { f -> f.isFile && f.name.startsWith("pos-") && f.name.endsWith(".db") }
                ?.sortedByDescending { it.lastModified() }
                ?: emptyList()
            for (old in existing.drop(30)) {
                old.delete()
            }
            return target.absolutePath
        }

        @JavascriptInterface
        fun selftestPath(): String {
            val dir = File(filesDir.parentFile!!, "databases").apply { mkdirs() }
            val db = File(dir, "selftest.db")
            for (suffix in listOf("", "-wal", "-shm", ".copy", ".copy-wal", ".copy-shm")) {
                File(dir, "selftest.db$suffix").delete()
            }
            return db.absolutePath
        }
    }
}

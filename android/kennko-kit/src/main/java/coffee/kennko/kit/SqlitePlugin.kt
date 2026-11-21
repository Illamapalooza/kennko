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
            val existing = dir.listFiles { f -> f.isFile && f.name.startsWith("pos-") && f.name.endsWith(".db") }
                ?.sortedByDescending { it.lastModified() }
                ?: emptyList()
            for (old in existing.drop(30)) {
                old.delete()
            }
            return File(dir, "pos-$day.db").absolutePath
        }

        @JavascriptInterface
        fun selftestPath(): String {
            val dir = File(filesDir.parentFile!!, "databases").apply { mkdirs() }
            return File(dir, "selftest.db").absolutePath
        }
    }
}

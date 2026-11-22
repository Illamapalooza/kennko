package coffee.kennko.kit

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.util.concurrent.Executors

@CapacitorPlugin(name = "KennkoFind")
class FindPlugin : Plugin() {
    private val exec = Executors.newSingleThreadExecutor { r ->
        Thread(r, "kennko-find").apply { isDaemon = true }
    }

    @PluginMethod
    fun find(call: PluginCall) {
        val timeoutMs = (call.getInt("timeoutMs") ?: 5000).toLong().coerceIn(500L, 15_000L)
        exec.execute {
            val found = TillFinder(context).find(timeoutMs)
            if (found != null) {
                call.resolve(JSObject().put("host", found.first).put("port", found.second))
            } else {
                call.resolve(JSObject().put("none", true))
            }
        }
    }
}

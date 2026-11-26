package coffee.kennko.kit

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.wifi.WifiManager
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Socket
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

/**
 * Capacitor plugin for the POS tablet: discovers Kennko Wall on the LAN
 * (`_kennko-wall._tcp.`) or falls back to a saved projector IP, then sends
 * `POST /open` to bring Kennko Wall to the foreground on the projector.
 */
@CapacitorPlugin(name = "KennkoWallControl")
class WallControlPlugin : Plugin() {
    private val executor = Executors.newSingleThreadExecutor()

    companion object {
        const val SERVICE_TYPE = "_kennko-wall._tcp."
        const val SERVICE_NAME = "Kennko Wall"
        const val DEFAULT_FALLBACK_HOST = "192.168.1.51"
        const val DEFAULT_PORT = WallWakeServer.DEFAULT_PORT
    }

    @PluginMethod
    fun openProjector(call: PluginCall) {
        val requestedHost = call.getString("host")?.trim().orEmpty()
        executor.execute {
            val discovered = discoverWall(timeoutMs = 1500)
            val candidates = ArrayList<Pair<String, Int>>()
            if (discovered != null) candidates.add(discovered)
            if (requestedHost.isNotEmpty()) {
                val parsed = parseHostPort(requestedHost)
                if (candidates.none { it == parsed }) candidates.add(parsed)
            }
            val fallback = DEFAULT_FALLBACK_HOST to DEFAULT_PORT
            if (candidates.none { it == fallback }) candidates.add(fallback)

            var lastError = "Could not reach the projector on Wi-Fi."
            for ((host, port) in candidates) {
                try {
                    val addr = InetAddress.getByName(host)
                    if (!addr.isSiteLocalAddress && !addr.isLoopbackAddress) {
                        lastError = "Projector IP must be on the local shop Wi-Fi."
                        continue
                    }
                    val statusCode = sendLanPostOpen(addr, host, port)
                    if (statusCode in 200..299) {
                        call.resolve(JSObject().put("ok", true).put("host", host).put("port", port))
                        return@execute
                    }
                    lastError = "Projector answered HTTP $statusCode."
                } catch (_: Exception) {
                    lastError = "Projector not reachable at $host:$port. Make sure the projector is on and on Kennko Wi-Fi."
                }
            }
            call.resolve(JSObject().put("ok", false).put("error", lastError))
        }
    }

    private fun sendLanPostOpen(addr: InetAddress, host: String, port: Int): Int {
        Socket().use { socket ->
            socket.connect(InetSocketAddress(addr, port), 2500)
            socket.soTimeout = 2500
            val req = "POST /open HTTP/1.1\r\nHost: $host:$port\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
            socket.getOutputStream().apply {
                write(req.toByteArray(Charsets.US_ASCII))
                flush()
            }
            val statusLine = BufferedReader(InputStreamReader(socket.getInputStream())).readLine() ?: return 0
            return statusLine.split(" ").getOrNull(1)?.toIntOrNull() ?: 0
        }
    }

    private fun parseHostPort(raw: String): Pair<String, Int> {
        val cleaned = raw.removePrefix("http://").removePrefix("https://").substringBefore("/").trim()
        val idx = cleaned.lastIndexOf(':')
        if (idx > 0) {
            val port = cleaned.substring(idx + 1).toIntOrNull()
            if (port != null && port in 1..65535) {
                return cleaned.substring(0, idx) to port
            }
        }
        return cleaned to DEFAULT_PORT
    }

    private fun discoverWall(timeoutMs: Long): Pair<String, Int>? {
        val nsd = context.getSystemService(Context.NSD_SERVICE) as? NsdManager ?: return null
        val wifi = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
        val lock = try {
            wifi?.createMulticastLock("kennko-wall-find")?.apply {
                setReferenceCounted(false)
                acquire()
            }
        } catch (_: Exception) {
            null
        }
        val latch = CountDownLatch(1)
        val result = AtomicReference<Pair<String, Int>?>(null)

        val listener = object : NsdManager.DiscoveryListener {
            override fun onDiscoveryStarted(regType: String) {}
            override fun onServiceFound(service: NsdServiceInfo) {
                if (result.get() != null) return
                if (!service.serviceName.contains(SERVICE_NAME, ignoreCase = true)) return
                @Suppress("DEPRECATION")
                nsd.resolveService(service, object : NsdManager.ResolveListener {
                    override fun onResolveFailed(info: NsdServiceInfo, errorCode: Int) {}
                    override fun onServiceResolved(info: NsdServiceInfo) {
                        val host = info.host?.hostAddress ?: return
                        if (result.compareAndSet(null, host to info.port)) {
                            latch.countDown()
                        }
                    }
                })
            }
            override fun onServiceLost(service: NsdServiceInfo) {}
            override fun onDiscoveryStopped(serviceType: String) {}
            override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) { latch.countDown() }
            override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) {}
        }

        try {
            nsd.discoverServices(SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, listener)
            latch.await(timeoutMs, TimeUnit.MILLISECONDS)
        } catch (_: Exception) {
        } finally {
            try { nsd.stopServiceDiscovery(listener) } catch (_: Exception) {}
            try { if (lock?.isHeld == true) lock.release() } catch (_: Exception) {}
        }
        return result.get()
    }
}

package coffee.kennko.kit

import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Tiny LAN HTTP server on the projector wall (default port 4477) so the POS tablet
 * can bring Kennko Wall to the foreground with a single POST /open request.
 */
class WallWakeServer(
    private val port: Int = DEFAULT_PORT,
    private val onOpen: () -> Unit,
) {
    companion object {
        const val DEFAULT_PORT = 4477
    }

    private val running = AtomicBoolean(false)
    private var serverSocket: ServerSocket? = null
    private var acceptThread: Thread? = null
    private val workers = Executors.newCachedThreadPool()

    val boundPort: Int
        get() = serverSocket?.localPort ?: port

    fun start() {
        if (!running.compareAndSet(false, true)) return
        val ss = ServerSocket()
        ss.reuseAddress = true
        ss.bind(InetSocketAddress(port))
        serverSocket = ss
        acceptThread = Thread({
            while (running.get()) {
                val client = try {
                    ss.accept()
                } catch (_: Exception) {
                    break
                }
                workers.execute { handle(client) }
            }
        }, "kennko-wall-wake").apply {
            isDaemon = true
            start()
        }
    }

    fun stop() {
        if (!running.compareAndSet(true, false)) return
        try { serverSocket?.close() } catch (_: Exception) {}
        serverSocket = null
        acceptThread = null
    }

    private fun handle(socket: Socket) {
        try {
            socket.soTimeout = 3000
            val reader = BufferedReader(InputStreamReader(socket.getInputStream()))
            val reqLine = reader.readLine() ?: return
            // Drain headers so the client gets a clean response.
            while (true) {
                val line = reader.readLine() ?: break
                if (line.isEmpty()) break
            }
            val parts = reqLine.split(" ")
            val method = parts.getOrNull(0)?.uppercase() ?: ""
            val path = parts.getOrNull(1)?.substringBefore("?") ?: "/"

            val (status, body) = when {
                method == "GET" && path == "/health" -> "200 OK" to """{"ok":true}"""
                (method == "POST" || method == "GET") && path == "/open" -> {
                    try {
                        onOpen()
                        "200 OK" to """{"ok":true}"""
                    } catch (e: Exception) {
                        "500 Internal Server Error" to """{"ok":false,"error":"${e.message?.replace("\"", "'") ?: "failed"}"}"""
                    }
                }
                else -> "404 Not Found" to """{"ok":false,"error":"not_found"}"""
            }

            val bytes = body.toByteArray(Charsets.UTF_8)
            val response = buildString {
                append("HTTP/1.1 ").append(status).append("\r\n")
                append("Content-Type: application/json\r\n")
                append("Access-Control-Allow-Origin: *\r\n")
                append("Content-Length: ").append(bytes.size).append("\r\n")
                append("Connection: close\r\n\r\n")
            }
            val out = socket.getOutputStream()
            out.write(response.toByteArray(Charsets.US_ASCII))
            out.write(bytes)
            out.flush()
        } catch (_: Exception) {
            // Ignore dropped LAN probes.
        } finally {
            try { socket.close() } catch (_: Exception) {}
        }
    }
}

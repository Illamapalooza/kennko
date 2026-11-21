package coffee.kennko.kit

import java.io.BufferedInputStream
import java.io.IOException
import java.io.OutputStream
import java.net.ServerSocket
import java.net.Socket
import java.nio.charset.StandardCharsets
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit

class WallFeedServer(
    private val port: Int = 4466,
    private val keepaliveMs: Long = 20_000,
) {
    private var serverSocket: ServerSocket? = null
    private var acceptThread: Thread? = null
    private var keepaliveExec: ScheduledExecutorService? = null
    @Volatile private var running = false
    @Volatile private var latestFrame: String? = null
    @Volatile private var latestMenu: String = "[]"

    private class SseClient(val socket: Socket, val out: OutputStream) {
        @Synchronized
        fun send(text: String): Boolean {
            return try {
                out.write(text.toByteArray(StandardCharsets.UTF_8))
                out.flush()
                true
            } catch (_: IOException) {
                false
            }
        }

        fun close() {
            try { socket.close() } catch (_: IOException) {}
        }
    }

    private val clients = CopyOnWriteArrayList<SseClient>()

    val boundPort: Int
        get() = serverSocket?.localPort ?: port

    val clientCount: Int
        get() = clients.size

    fun start() {
        if (running) return
        val ss = ServerSocket(port)
        serverSocket = ss
        running = true

        val ka = Executors.newSingleThreadScheduledExecutor { r ->
            Thread(r, "kennko-wall-ka").apply { isDaemon = true }
        }
        keepaliveExec = ka
        ka.scheduleAtFixedRate({
            for (c in clients) {
                if (!c.send(": keepalive\n\n")) {
                    clients.remove(c)
                    c.close()
                }
            }
        }, keepaliveMs, keepaliveMs, TimeUnit.MILLISECONDS)

        acceptThread = Thread({
            while (running) {
                val sock = try {
                    ss.accept()
                } catch (_: IOException) {
                    break
                }
                Thread({ handleConnection(sock) }, "kennko-wall-conn").apply {
                    isDaemon = true
                    start()
                }
            }
        }, "kennko-wall-accept").apply {
            isDaemon = true
            start()
        }
    }

    fun stop() {
        running = false
        try { serverSocket?.close() } catch (_: IOException) {}
        serverSocket = null
        keepaliveExec?.shutdownNow()
        keepaliveExec = null
        for (c in clients) c.close()
        clients.clear()
    }

    fun publish(frameJson: String) {
        latestFrame = frameJson
        val payload = "data: $frameJson\n\n"
        for (c in clients) {
            if (!c.send(payload)) {
                clients.remove(c)
                c.close()
            }
        }
    }

    fun setMenu(menuJson: String) {
        latestMenu = menuJson
    }

    private fun readHeaderBlock(input: BufferedInputStream): String? {
        val buf = ByteArray(8193)
        var len = 0
        while (len < buf.size) {
            val b = input.read()
            if (b == -1) return null
            buf[len++] = b.toByte()
            if (len > 8192) return null
            if (len >= 4 &&
                buf[len - 4] == '\r'.code.toByte() &&
                buf[len - 3] == '\n'.code.toByte() &&
                buf[len - 2] == '\r'.code.toByte() &&
                buf[len - 1] == '\n'.code.toByte()
            ) {
                return String(buf, 0, len, StandardCharsets.ISO_8859_1)
            }
        }
        return null
    }

    private fun handleConnection(sock: Socket) {
        try {
            sock.soTimeout = 5000
            val input = BufferedInputStream(sock.getInputStream())
            val headerBlock = readHeaderBlock(input)
            if (headerBlock == null) {
                sock.close()
                return
            }
            val firstLine = headerBlock.lineSequence().firstOrNull() ?: run {
                sock.close()
                return
            }
            val parts = firstLine.split(' ')
            if (parts.size < 2) {
                sock.close()
                return
            }
            val method = parts[0]
            val rawPath = parts[1].substringBefore('?')
            val out = sock.getOutputStream()

            if (method != "GET") {
                sendSimple(out, 405, "Method Not Allowed", "text/plain", "Method Not Allowed")
                sock.close()
                return
            }

            when (rawPath) {
                "/api/wall/menu" -> {
                    val body = """{"menu":$latestMenu}"""
                    sendSimple(out, 200, "OK", "application/json; charset=utf-8", body)
                    sock.close()
                }
                "/api/wall/events" -> {
                    sock.soTimeout = 0
                    val headers = buildString {
                        append("HTTP/1.1 200 OK\r\n")
                        append("Content-Type: text/event-stream\r\n")
                        append("Cache-Control: no-store\r\n")
                        append("Connection: keep-alive\r\n")
                        append("Access-Control-Allow-Origin: *\r\n")
                        append("\r\n")
                        append("retry: 2000\n\n")
                    }
                    val client = SseClient(sock, out)
                    if (!client.send(headers)) {
                        client.close()
                        return
                    }
                    synchronized(clients) {
                        while (clients.size >= 8) {
                            val oldest = clients.removeAt(0)
                            oldest.close()
                        }
                        clients.add(client)
                    }
                    latestFrame?.let { frame ->
                        if (!client.send("data: $frame\n\n")) {
                            clients.remove(client)
                            client.close()
                            return
                        }
                    }
                    // Block until client disconnects
                    while (running && !sock.isClosed) {
                        if (input.read() == -1) break
                    }
                    clients.remove(client)
                    client.close()
                }
                else -> {
                    sendSimple(out, 404, "Not Found", "text/plain", "Not Found")
                    sock.close()
                }
            }
        } catch (_: IOException) {
            try { sock.close() } catch (_: IOException) {}
        }
    }

    private fun sendSimple(out: OutputStream, status: Int, reason: String, contentType: String, body: String) {
        val bytes = body.toByteArray(StandardCharsets.UTF_8)
        val head = buildString {
            append("HTTP/1.1 $status $reason\r\n")
            append("Content-Type: $contentType\r\n")
            append("Content-Length: ${bytes.size}\r\n")
            append("Cache-Control: no-store\r\n")
            append("Access-Control-Allow-Origin: *\r\n")
            append("Connection: close\r\n")
            append("\r\n")
        }
        out.write(head.toByteArray(StandardCharsets.UTF_8))
        out.write(bytes)
        out.flush()
    }
}

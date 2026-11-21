package coffee.kennko.kit

import org.junit.After
import org.junit.Assert.*
import org.junit.Test
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.Socket
import java.net.URL

class WallFeedServerTest {
    private var server: WallFeedServer? = null

    @After
    fun tearDown() {
        server?.stop()
    }

    private fun startServer(keepaliveMs: Long = 20_000): WallFeedServer {
        val s = WallFeedServer(port = 0, keepaliveMs = keepaliveMs)
        s.start()
        server = s
        return s
    }

    private fun openSse(port: Int): Pair<Socket, BufferedReader> {
        val sock = Socket("127.0.0.1", port)
        sock.soTimeout = 3000
        val out = sock.getOutputStream()
        out.write("GET /api/wall/events HTTP/1.1\r\nHost: localhost\r\n\r\n".toByteArray())
        out.flush()
        val reader = BufferedReader(InputStreamReader(sock.getInputStream()))
        // Read headers until blank line
        while (true) {
            val line = reader.readLine() ?: break
            if (line.isEmpty()) break
        }
        return sock to reader
    }

    @Test
    fun `events sends retry then latest frame`() {
        val s = startServer()
        s.publish("""{"day":"2026-11-22"}""")
        val (sock, reader) = openSse(s.boundPort)
        assertEquals("retry: 2000", reader.readLine())
        assertEquals("", reader.readLine())
        assertEquals("""data: {"day":"2026-11-22"}""", reader.readLine())
        assertEquals("", reader.readLine())
        sock.close()
    }

    @Test
    fun `publish reaches every client`() {
        val s = startServer()
        val (s1, r1) = openSse(s.boundPort)
        val (s2, r2) = openSse(s.boundPort)
        assertEquals("retry: 2000", r1.readLine()); r1.readLine()
        assertEquals("retry: 2000", r2.readLine()); r2.readLine()

        s.publish("""{"n":1}""")
        assertEquals("""data: {"n":1}""", r1.readLine())
        assertEquals("""data: {"n":1}""", r2.readLine())
        s1.close()
        s2.close()
    }

    @Test
    fun `menu route wraps json`() {
        val s = startServer()
        s.setMenu("""[{"category":"Coffee","items":[]}]""")
        val conn = URL("http://127.0.0.1:${s.boundPort}/api/wall/menu").openConnection() as HttpURLConnection
        assertEquals(200, conn.responseCode)
        assertEquals("*", conn.getHeaderField("Access-Control-Allow-Origin"))
        val body = conn.inputStream.bufferedReader().readText()
        assertEquals("""{"menu":[{"category":"Coffee","items":[]}]}""", body)
    }

    @Test
    fun `unknown path 404`() {
        val s = startServer()
        val conn = URL("http://127.0.0.1:${s.boundPort}/nope").openConnection() as HttpURLConnection
        assertEquals(404, conn.responseCode)
    }

    @Test
    fun `POST 405`() {
        val s = startServer()
        val conn = URL("http://127.0.0.1:${s.boundPort}/api/wall/menu").openConnection() as HttpURLConnection
        conn.requestMethod = "POST"
        assertEquals(405, conn.responseCode)
    }

    @Test
    fun `oversized headers closed`() {
        val s = startServer()
        val sock = Socket("127.0.0.1", s.boundPort)
        sock.soTimeout = 2000
        val out = sock.getOutputStream()
        val big = "X-Big: " + "a".repeat(9000) + "\r\n"
        out.write("GET /api/wall/menu HTTP/1.1\r\n$big\r\n".toByteArray())
        out.flush()
        val res = sock.getInputStream().read()
        assertEquals(-1, res)
        sock.close()
    }

    @Test
    fun `stop closes clients`() {
        val s = startServer()
        val (sock, reader) = openSse(s.boundPort)
        assertEquals("retry: 2000", reader.readLine())
        s.stop()
        // Reading should hit EOF
        while (reader.readLine() != null) {}
        sock.close()
    }

    @Test
    fun `ninth client drops the oldest`() {
        val s = startServer()
        val sockets = (1..9).map {
            val pair = openSse(s.boundPort)
            pair.second.readLine() // retry: 2000
            pair.second.readLine() // blank
            pair
        }
        Thread.sleep(50)
        assertTrue("expected <= 8 clients, got ${s.clientCount}", s.clientCount <= 8)
        for ((sock, _) in sockets) sock.close()
    }
}

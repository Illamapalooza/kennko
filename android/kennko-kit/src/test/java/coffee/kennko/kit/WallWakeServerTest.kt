package coffee.kennko.kit

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.atomic.AtomicInteger

class WallWakeServerTest {
    @Test
    fun `POST open triggers callback and returns 200`() {
        val opened = AtomicInteger(0)
        val server = WallWakeServer(port = 0) { opened.incrementAndGet() }
        server.start()
        try {
            val conn = (URL("http://127.0.0.1:${server.boundPort}/open").openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                connectTimeout = 2000
                readTimeout = 2000
            }
            assertEquals(200, conn.responseCode)
            val body = conn.inputStream.bufferedReader().readText()
            assertTrue(body.contains("\"ok\":true"))
            assertEquals(1, opened.get())
            conn.disconnect()
        } finally {
            server.stop()
        }
    }

    @Test
    fun `GET health returns 200 without triggering open`() {
        val opened = AtomicInteger(0)
        val server = WallWakeServer(port = 0) { opened.incrementAndGet() }
        server.start()
        try {
            val conn = (URL("http://127.0.0.1:${server.boundPort}/health").openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"
                connectTimeout = 2000
                readTimeout = 2000
            }
            assertEquals(200, conn.responseCode)
            assertEquals(0, opened.get())
            conn.disconnect()
        } finally {
            server.stop()
        }
    }
}

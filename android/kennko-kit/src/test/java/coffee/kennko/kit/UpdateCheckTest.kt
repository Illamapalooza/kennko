package coffee.kennko.kit

import org.junit.Assert.*
import org.junit.Test

class UpdateCheckTest {
    @Test
    fun `parses entry`() {
        val json = """
            {
              "pos": { "versionCode": 10003, "versionName": "1.0.3", "url": "https://example.com/pos.apk", "notes": "Faster sync" },
              "wall": { "versionCode": 0, "versionName": "0.0.0", "url": "", "notes": "" }
            }
        """.trimIndent()
        val entry = UpdateCheck.parseUpdates(json, "pos")
        assertNotNull(entry)
        assertEquals(10003, entry!!.versionCode)
        assertEquals("1.0.3", entry.versionName)
        assertEquals("https://example.com/pos.apk", entry.url)
        assertEquals("Faster sync", entry.notes)
    }

    @Test
    fun `unknown app null`() {
        val json = """{"pos":{"versionCode":10001,"versionName":"1.0.1","url":"https://x.com/a.apk","notes":""}}"""
        assertNull(UpdateCheck.parseUpdates(json, "other"))
    }

    @Test
    fun `http url refused`() {
        val json = """{"pos":{"versionCode":10001,"versionName":"1.0.1","url":"http://x.com/a.apk","notes":""}}"""
        assertNull(UpdateCheck.parseUpdates(json, "pos"))
    }

    @Test
    fun `malformed null`() {
        assertNull(UpdateCheck.parseUpdates("{not json", "pos"))
        assertNull(UpdateCheck.parseUpdates("", "pos"))
    }

    @Test
    fun `isNewer only when greater`() {
        val entry = UpdateEntry(10002, "1.0.2", "https://x.com/a.apk", "")
        assertTrue(UpdateCheck.isNewer(entry, 10001L))
        assertFalse(UpdateCheck.isNewer(entry, 10002L))
        assertFalse(UpdateCheck.isNewer(entry, 10003L))
        assertFalse(UpdateCheck.isNewer(null, 1L))
    }
}

package coffee.kennko.kit

import org.json.JSONObject

data class UpdateEntry(
  val versionCode: Int,
  val versionName: String,
  val url: String,
  val notes: String,
)

object UpdateCheck {
  fun parseUpdates(json: String, app: String): UpdateEntry? {
    if (app.isBlank()) return null
    return try {
      val root = JSONObject(json)
      val obj = root.optJSONObject(app) ?: return null
      val versionCode = obj.optInt("versionCode", -1)
      val versionName = obj.optString("versionName", "")
      val url = obj.optString("url", "")
      val notes = obj.optString("notes", "")
      if (versionCode < 1) return null
      if (versionName.isBlank()) return null
      if (!url.startsWith("https://")) return null
      UpdateEntry(versionCode, versionName, url, notes)
    } catch (_: Exception) {
      null
    }
  }

  fun isNewer(entry: UpdateEntry?, installed: Long): Boolean {
    if (entry == null) return false
    return entry.versionCode.toLong() > installed
  }
}

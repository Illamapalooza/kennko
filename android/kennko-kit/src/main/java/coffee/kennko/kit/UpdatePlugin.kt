package coffee.kennko.kit

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ApplicationInfo
import android.content.pm.PackageInstaller
import android.net.Uri
import android.os.Build
import android.provider.Settings
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

@CapacitorPlugin(name = "KennkoUpdate")
class UpdatePlugin : Plugin() {
  private val executor = Executors.newSingleThreadExecutor()

  companion object {
    private const val DEFAULT_UPDATES_URL = "https://kennko.vercel.app/apps/updates.json"
    private const val TIMEOUT_MS = 5000
    private const val DOWNLOAD_TIMEOUT_MS = 15000
    private const val INSTALL_FAILED_MSG = "The update did not install. Try again, or ask Julius."
  }

  private fun appKey(): String = config.getString("app", "") ?: ""

  private fun updatesUrl(): String {
    val isDebug = (context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0
    if (isDebug) {
      val override = config.getString("updatesUrl")
      if (!override.isNullOrBlank()) return override
    }
    return DEFAULT_UPDATES_URL
  }

  private fun installedVersionCode(): Long {
    val info = context.packageManager.getPackageInfo(context.packageName, 0)
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      info.longVersionCode
    } else {
      @Suppress("DEPRECATION")
      info.versionCode.toLong()
    }
  }

  private fun fetchText(urlString: String, timeoutMs: Int): String {
    val conn = (URL(urlString).openConnection() as HttpURLConnection).apply {
      connectTimeout = timeoutMs
      readTimeout = timeoutMs
      requestMethod = "GET"
    }
    try {
      val code = conn.responseCode
      if (code !in 200..299) throw IllegalStateException("HTTP $code")
      return conn.inputStream.bufferedReader().use { it.readText() }
    } finally {
      conn.disconnect()
    }
  }

  private fun downloadToFile(urlString: String, target: File) {
    val conn = (URL(urlString).openConnection() as HttpURLConnection).apply {
      connectTimeout = DOWNLOAD_TIMEOUT_MS
      readTimeout = DOWNLOAD_TIMEOUT_MS
      requestMethod = "GET"
    }
    try {
      val code = conn.responseCode
      if (code !in 200..299) throw IllegalStateException("HTTP $code")
      conn.inputStream.use { input ->
        target.outputStream().use { output ->
          input.copyTo(output)
        }
      }
    } finally {
      conn.disconnect()
    }
  }

  @PluginMethod
  fun check(call: PluginCall) {
    val app = appKey()
    val url = updatesUrl()
    executor.execute {
      val res = JSObject()
      try {
        val json = fetchText(url, TIMEOUT_MS)
        val entry = UpdateCheck.parseUpdates(json, app)
        if (entry != null && UpdateCheck.isNewer(entry, installedVersionCode())) {
          res.put("available", true)
          res.put("versionName", entry.versionName)
          res.put("notes", entry.notes)
        } else {
          res.put("available", false)
        }
      } catch (_: Exception) {
        res.put("available", false)
      }
      call.resolve(res)
    }
  }

  @PluginMethod
  fun install(call: PluginCall) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !context.packageManager.canRequestPackageInstalls()) {
      val intent = Intent(
        Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
        Uri.parse("package:${context.packageName}"),
      ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
      call.resolve(JSObject().put("error", "Allow Kennko to install updates, then tap Update again."))
      return
    }

    val app = appKey()
    val url = updatesUrl()
    executor.execute {
      val apkFile = File(context.cacheDir, "update.apk")
      try {
        val json = fetchText(url, TIMEOUT_MS)
        val entry = UpdateCheck.parseUpdates(json, app)
        if (entry == null || !UpdateCheck.isNewer(entry, installedVersionCode())) {
          call.resolve(JSObject().put("error", INSTALL_FAILED_MSG))
          return@execute
        }

        downloadToFile(entry.url, apkFile)
        commitPackageInstallerSession(apkFile, call)
      } catch (_: Exception) {
        apkFile.delete()
        call.resolve(JSObject().put("error", INSTALL_FAILED_MSG))
      }
    }
  }

  private fun commitPackageInstallerSession(apkFile: File, call: PluginCall) {
    val action = "${context.packageName}.KENNKO_UPDATE_RESULT"
    val receiver = object : BroadcastReceiver() {
      override fun onReceive(ctx: Context, intent: Intent) {
        val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)
        if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
          @Suppress("DEPRECATION")
          val confirmIntent = intent.getParcelableExtra<Intent>(Intent.EXTRA_INTENT)
          if (confirmIntent != null) {
            confirmIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            ctx.startActivity(confirmIntent)
          } else {
            cleanup()
            call.resolve(JSObject().put("error", INSTALL_FAILED_MSG))
          }
          return
        }

        cleanup()
        if (status == PackageInstaller.STATUS_SUCCESS) {
          call.resolve(JSObject().put("installed", true))
        } else {
          call.resolve(JSObject().put("error", INSTALL_FAILED_MSG))
        }
      }

      private fun cleanup() {
        try {
          context.unregisterReceiver(this)
        } catch (_: Exception) {
        }
        apkFile.delete()
      }
    }

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      context.registerReceiver(receiver, IntentFilter(action), Context.RECEIVER_NOT_EXPORTED)
    } else {
      @Suppress("DEPRECATION")
      context.registerReceiver(receiver, IntentFilter(action))
    }

    val installer = context.packageManager.packageInstaller
    val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
    val sessionId = installer.createSession(params)
    val session = installer.openSession(sessionId)
    try {
      apkFile.inputStream().use { input ->
        session.openWrite("update.apk", 0, apkFile.length()).use { out ->
          input.copyTo(out)
          session.fsync(out)
        }
      }
      val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        PendingIntent.FLAG_MUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
      } else {
        PendingIntent.FLAG_UPDATE_CURRENT
      }
      val statusIntent = Intent(action).setPackage(context.packageName)
      val pending = PendingIntent.getBroadcast(context, sessionId, statusIntent, flags)
      session.commit(pending.intentSender)
    } catch (e: Exception) {
      session.abandon()
      try {
        context.unregisterReceiver(receiver)
      } catch (_: Exception) {
      }
      apkFile.delete()
      throw e
    } finally {
      session.close()
    }
  }
}

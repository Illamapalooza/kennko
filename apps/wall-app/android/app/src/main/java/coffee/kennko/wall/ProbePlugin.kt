package coffee.kennko.wall

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.webkit.WebView
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.util.concurrent.atomic.AtomicBoolean

@CapacitorPlugin(name = "KennkoProbe")
class ProbePlugin : Plugin() {

    @PluginMethod
    fun info(call: PluginCall) {
        val pkg = if (Build.VERSION.SDK_INT >= 26) WebView.getCurrentWebViewPackage() else null
        val ret = JSObject()
        ret.put("android", Build.VERSION.RELEASE ?: "")
        ret.put("sdk", Build.VERSION.SDK_INT)
        ret.put("webViewPackage", pkg?.packageName ?: "unknown")
        ret.put("webViewVersion", pkg?.versionName ?: "unknown")
        ret.put("model", "${Build.MANUFACTURER} ${Build.MODEL}")
        ret.put("canDrawOverlays", Settings.canDrawOverlays(context))
        call.resolve(ret)
    }

    @PluginMethod
    fun requestOverlay(call: PluginCall) {
        val intent = Intent(
            Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
            Uri.parse("package:${context.packageName}")
        ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
        call.resolve()
    }

    @PluginMethod
    fun discover(call: PluginCall) {
        val serviceType = call.getString("type") ?: "_kennko-pos._tcp."
        val nsd = context.getSystemService(Context.NSD_SERVICE) as NsdManager
        val wifi = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
        val lock = wifi.createMulticastLock("kennko-probe").apply { setReferenceCounted(false); acquire() }
        val done = AtomicBoolean(false)
        val handler = Handler(Looper.getMainLooper())

        var discoveryListener: NsdManager.DiscoveryListener? = null

        fun finish(result: JSObject) {
            if (!done.compareAndSet(false, true)) return
            try { discoveryListener?.let { nsd.stopServiceDiscovery(it) } } catch (_: Exception) {}
            try { if (lock.isHeld) lock.release() } catch (_: Exception) {}
            call.resolve(result)
        }

        discoveryListener = object : NsdManager.DiscoveryListener {
            override fun onDiscoveryStarted(regType: String) {}
            override fun onServiceFound(service: NsdServiceInfo) {
                if (done.get()) return
                if (!service.serviceName.contains("Kennko POS", ignoreCase = true)) return
                @Suppress("DEPRECATION")
                nsd.resolveService(service, object : NsdManager.ResolveListener {
                    override fun onResolveFailed(info: NsdServiceInfo, errorCode: Int) {}
                    override fun onServiceResolved(info: NsdServiceInfo) {
                        val host = info.host?.hostAddress ?: return
                        val obj = JSObject().put("host", host).put("port", info.port)
                        finish(obj)
                    }
                })
            }
            override fun onServiceLost(service: NsdServiceInfo) {}
            override fun onDiscoveryStopped(serviceType: String) {}
            override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) {
                finish(JSObject().put("error", "start failed ($errorCode)"))
            }
            override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) {}
        }

        try {
            nsd.discoverServices(serviceType, NsdManager.PROTOCOL_DNS_SD, discoveryListener)
        } catch (e: Exception) {
            finish(JSObject().put("error", e.message ?: "discover failed"))
            return
        }

        handler.postDelayed({
            finish(JSObject().put("error", "timeout (10s)"))
        }, 10_000)
    }
}

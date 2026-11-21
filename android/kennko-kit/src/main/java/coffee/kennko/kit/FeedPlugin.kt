package coffee.kennko.kit

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

@CapacitorPlugin(name = "KennkoFeed")
class FeedPlugin : Plugin() {
    private val server = WallFeedServer(port = 4466)
    private var regListener: NsdManager.RegistrationListener? = null

    override fun handleOnStart() {
        server.start()
        registerNsd()
    }

    override fun handleOnStop() {
        unregisterNsd()
        server.stop()
    }

    @PluginMethod
    fun publish(call: PluginCall) {
        val frame = call.getString("frame") ?: ""
        server.publish(frame)
        call.resolve()
    }

    @PluginMethod
    fun setMenu(call: PluginCall) {
        val menu = call.getString("menu") ?: "[]"
        server.setMenu(menu)
        call.resolve()
    }

    private fun registerNsd() {
        if (regListener != null) return
        val nsd = context.getSystemService(Context.NSD_SERVICE) as NsdManager
        val info = NsdServiceInfo().apply {
            serviceName = "Kennko POS"
            serviceType = "_kennko-pos._tcp."
            port = server.boundPort
            setAttribute("v", "1")
        }
        val listener = object : NsdManager.RegistrationListener {
            override fun onServiceRegistered(serviceInfo: NsdServiceInfo) {}
            override fun onRegistrationFailed(serviceInfo: NsdServiceInfo, errorCode: Int) {}
            override fun onServiceUnregistered(serviceInfo: NsdServiceInfo) {}
            override fun onUnregistrationFailed(serviceInfo: NsdServiceInfo, errorCode: Int) {}
        }
        regListener = listener
        try {
            nsd.registerService(info, NsdManager.PROTOCOL_DNS_SD, listener)
        } catch (_: Exception) {
            regListener = null
        }
    }

    private fun unregisterNsd() {
        val listener = regListener ?: return
        regListener = null
        val nsd = context.getSystemService(Context.NSD_SERVICE) as NsdManager
        try {
            nsd.unregisterService(listener)
        } catch (_: Exception) {}
    }
}

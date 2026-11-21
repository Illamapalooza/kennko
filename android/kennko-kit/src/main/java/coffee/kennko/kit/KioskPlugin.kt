package coffee.kennko.kit

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

@CapacitorPlugin(name = "KennkoKiosk")
class KioskPlugin : Plugin() {
    @PluginMethod
    fun askBatteryOnce(call: PluginCall) {
        val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
        if (Build.VERSION.SDK_INT >= 23 && pm.isIgnoringBatteryOptimizations(context.packageName)) {
            call.resolve(JSObject().put("asked", false))
            return
        }
        val prefs = context.getSharedPreferences("kennko_kiosk", Context.MODE_PRIVATE)
        if (prefs.getBoolean("asked_battery", false)) {
            call.resolve(JSObject().put("asked", false))
            return
        }
        prefs.edit().putBoolean("asked_battery", true).apply()
        if (Build.VERSION.SDK_INT >= 23) {
            val intent = Intent(
                Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                Uri.parse("package:${context.packageName}")
            ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(intent)
        }
        call.resolve(JSObject().put("asked", true))
    }
}

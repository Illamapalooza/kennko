package coffee.kennko.wall

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED) {
            val launch = Intent(context, MainActivity::class.java).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            }
            try {
                context.startActivity(launch)
            } catch (_: Exception) {
                // Android 10+ may block background activity starts unless SYSTEM_ALERT_WINDOW is granted.
            }
        }
    }
}

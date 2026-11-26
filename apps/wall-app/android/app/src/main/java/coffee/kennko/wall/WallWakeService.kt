package coffee.kennko.wall

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.os.Build
import android.os.IBinder
import coffee.kennko.kit.WallControlPlugin
import coffee.kennko.kit.WallWakeServer

/**
 * Lightweight background foreground-service on the Wanbo projector so the Samsung POS
 * tablet can bring Kennko Wall to the foreground with a single tap over Wi-Fi.
 */
class WallWakeService : Service() {
    companion object {
        private const val CHANNEL_ID = "kennko_wall_wake"
        private const val NOTIF_ID = 4477

        fun ensureStarted(context: Context) {
            val intent = Intent(context, WallWakeService::class.java)
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(intent)
                } else {
                    context.startService(intent)
                }
            } catch (_: Exception) {
                // Ignore if background start is restricted before first foreground open.
            }
        }
    }

    private var server: WallWakeServer? = null
    private var regListener: NsdManager.RegistrationListener? = null

    override fun onCreate() {
        super.onCreate()
        startForegroundNotification()
        val srv = WallWakeServer(port = WallWakeServer.DEFAULT_PORT) {
            val launch = Intent(this, MainActivity::class.java).apply {
                addFlags(
                    Intent.FLAG_ACTIVITY_NEW_TASK or
                        Intent.FLAG_ACTIVITY_SINGLE_TOP or
                        Intent.FLAG_ACTIVITY_REORDER_TO_FRONT,
                )
            }
            startActivity(launch)
        }
        try {
            srv.start()
            server = srv
            registerNsd(srv.boundPort)
        } catch (_: Exception) {
            // Port already bound or unavailable; stay alive.
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        return START_STICKY
    }

    override fun onDestroy() {
        unregisterNsd()
        server?.stop()
        server = null
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun startForegroundNotification() {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val ch = NotificationChannel(CHANNEL_ID, "Kennko Wall Remote", NotificationManager.IMPORTANCE_MIN)
            ch.setShowBadge(false)
            nm.createNotificationChannel(ch)
        }
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
        }
        val notif = builder
            .setContentTitle("Kennko Wall")
            .setContentText("Ready for POS remote open")
            .setSmallIcon(R.mipmap.ic_launcher)
            .setOngoing(true)
            .build()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(NOTIF_ID, notif, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        } else {
            startForeground(NOTIF_ID, notif)
        }
    }

    private fun registerNsd(port: Int) {
        if (regListener != null) return
        val nsd = getSystemService(Context.NSD_SERVICE) as? NsdManager ?: return
        val info = NsdServiceInfo().apply {
            serviceName = WallControlPlugin.SERVICE_NAME
            serviceType = WallControlPlugin.SERVICE_TYPE
            this.port = port
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
        val nsd = getSystemService(Context.NSD_SERVICE) as? NsdManager ?: return
        try { nsd.unregisterService(listener) } catch (_: Exception) {}
    }
}

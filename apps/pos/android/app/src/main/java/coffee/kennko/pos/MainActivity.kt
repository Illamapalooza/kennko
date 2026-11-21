package coffee.kennko.pos

import android.os.Bundle
import coffee.kennko.kit.FeedPlugin
import coffee.kennko.kit.Kiosk
import coffee.kennko.kit.KioskPlugin
import coffee.kennko.kit.SqlitePlugin
import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(SqlitePlugin::class.java)
        registerPlugin(KioskPlugin::class.java)
        registerPlugin(FeedPlugin::class.java)
        super.onCreate(savedInstanceState)
        Kiosk.keepScreenOn(this)
        bridge?.webView?.settings?.mediaPlaybackRequiresUserGesture = false
    }
}

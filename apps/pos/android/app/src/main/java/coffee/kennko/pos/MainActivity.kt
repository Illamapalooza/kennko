package coffee.kennko.pos

import android.os.Bundle
import coffee.kennko.kit.FeedPlugin
import coffee.kennko.kit.Kiosk
import coffee.kennko.kit.KioskPlugin
import coffee.kennko.kit.SqlitePlugin
import coffee.kennko.kit.UpdatePlugin
import coffee.kennko.kit.WallControlPlugin
import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(SqlitePlugin::class.java)
        registerPlugin(KioskPlugin::class.java)
        registerPlugin(FeedPlugin::class.java)
        registerPlugin(UpdatePlugin::class.java)
        registerPlugin(WallControlPlugin::class.java)
        super.onCreate(savedInstanceState)
        Kiosk.keepScreenOn(this)
        bridge?.webView?.settings?.mediaPlaybackRequiresUserGesture = false
    }
}

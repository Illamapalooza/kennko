package coffee.kennko.pos

import android.os.Bundle
import coffee.kennko.kit.SqlitePlugin
import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(SqlitePlugin::class.java)
        super.onCreate(savedInstanceState)
        bridge?.webView?.settings?.mediaPlaybackRequiresUserGesture = false
    }
}

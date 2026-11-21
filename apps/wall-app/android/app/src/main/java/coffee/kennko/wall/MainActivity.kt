package coffee.kennko.wall

import android.os.Bundle
import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(ProbePlugin::class.java)
        super.onCreate(savedInstanceState)
        bridge?.webView?.settings?.mediaPlaybackRequiresUserGesture = false
    }
}

package coffee.kennko.wall

import android.os.Bundle
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import coffee.kennko.kit.FindPlugin
import coffee.kennko.kit.Kiosk
import coffee.kennko.kit.UpdatePlugin
import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(FindPlugin::class.java)
        registerPlugin(UpdatePlugin::class.java)
        super.onCreate(savedInstanceState)
        Kiosk.keepScreenOn(this)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        WindowInsetsControllerCompat(window, window.decorView).apply {
            hide(WindowInsetsCompat.Type.systemBars())
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
        bridge?.webView?.apply {
            settings.mediaPlaybackRequiresUserGesture = false
            requestFocus()
        }
    }
}

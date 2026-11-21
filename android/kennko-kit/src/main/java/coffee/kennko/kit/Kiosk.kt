package coffee.kennko.kit

import android.app.Activity
import android.view.WindowManager

object Kiosk {
    fun keepScreenOn(activity: Activity) {
        activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }
}

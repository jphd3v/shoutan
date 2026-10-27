package io.github.jphd3v.shoutan.testlab

import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** Whether the app runs on a Firebase Test Lab device, where Google Play's pre-launch crawler tests it. */
class TestLabModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("TestLab")

    // Test Lab sets this system setting on its devices.
    Constant("onTestLab").get {
      val resolver = appContext.reactContext?.contentResolver
      resolver != null && Settings.System.getString(resolver, "firebase.test.lab") == "true"
    }
  }
}

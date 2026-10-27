package io.github.jphd3v.shoutan.net

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import android.app.ActivityManager
import android.content.Context
import java.nio.FloatBuffer

/**
 * Runs the bot's neural networks (KataGo, converted to ONNX by scripts/convert-net.py). The inputs are
 * encoded in TypeScript (src/go/katago.ts); this only evaluates them, off the JS thread.
 */
class GoNetModule : Module() {
  private val env: OrtEnvironment by lazy { OrtEnvironment.getEnvironment() }
  private val sessions = mutableMapOf<String, OrtSession>()

  private fun session(name: String): OrtSession = synchronized(sessions) {
    sessions.getOrPut(name) {
      val context = appContext.reactContext ?: throw IllegalStateException("No React context")
      val bytes = context.assets.open("nets/$name.onnx").use { it.readBytes() }
      val options = OrtSession.SessionOptions().apply {
        setIntraOpNumThreads(2)
        setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT)
      }
      env.createSession(bytes, options)
    }
  }

  override fun definition() = ModuleDefinition {
    Name("GoNet")

    // The phone's memory, so the app offers the large network only where it fits.
    Constant("totalMemory").get {
      val manager = appContext.reactContext?.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager?
      val info = ActivityManager.MemoryInfo()
      manager?.getMemoryInfo(info)
      if (manager == null) 0.0 else info.totalMem.toDouble()
    }

    AsyncFunction("load") { name: String ->
      session(name)
      return@AsyncFunction null
    }

    // `meta` is the human-style network's profile (src/go/human.ts); the other networks take none.
    AsyncFunction("evaluate") { name: String, size: Int, bin: ByteArray, global: DoubleArray, meta: DoubleArray? ->
      val s = session(name)
      val planes = bin.size / (size * size)
      val binFloats = FloatArray(bin.size) { bin[it].toFloat() }
      val globalFloats = FloatArray(global.size) { global[it].toFloat() }
      OnnxTensor.createTensor(env, FloatBuffer.wrap(binFloats), longArrayOf(1, planes.toLong(), size.toLong(), size.toLong())).use { binT ->
        OnnxTensor.createTensor(env, FloatBuffer.wrap(globalFloats), longArrayOf(1, global.size.toLong())).use { globalT ->
          val metaT = meta?.let { m ->
            OnnxTensor.createTensor(env, FloatBuffer.wrap(FloatArray(m.size) { m[it].toFloat() }), longArrayOf(1, m.size.toLong()))
          }
          val inputs = mutableMapOf("bin_input" to binT, "global_input" to globalT)
          if (metaT != null) inputs["input_meta"] = metaT
          try { s.run(inputs).use { out ->
            fun flat(key: String): FloatArray {
              val t = out.get(key).get() as OnnxTensor
              val buf = t.floatBuffer
              return FloatArray(buf.remaining()).also { buf.get(it) }
            }
            mapOf(
              "policy" to flat("policy"),
              "pass" to flat("pass"),
              "value" to flat("value"),
              "score" to flat("score"),
              "ownership" to flat("ownership"),
            )
          } } finally { metaT?.close() }
        }
      }
    }
  }
}

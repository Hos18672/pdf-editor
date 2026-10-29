package com.rezahossaini.peintents

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.CalendarContract
import android.provider.OpenableColumns
import android.util.Base64
import android.webkit.MimeTypeMap
import androidx.core.content.pm.ShortcutInfoCompat
import androidx.core.content.pm.ShortcutManagerCompat
import androidx.core.graphics.drawable.IconCompat
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * What the app was opened with: a PDF ("Open with"), files shared into it (the share sheet, also
 * through the "Convert to PDF" entry), or a shortcut / widget button (pdfeditor://action/<name>).
 * The page asks for it with takeIntent() and reads the files with readUri().
 */
class PeIntentsModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw IllegalStateException("No context")

  override fun definition() = ModuleDefinition {
    Name("PeIntents")
    Events("onIntent")

    OnCreate {
      try { publishShortcuts(context) } catch (e: Throwable) { /* launcher without shortcuts */ }
    }

    OnNewIntent { intent ->
      if (isRelevant(intent)) {
        pending = Intent(intent)
        intent.putExtra(SEEN, true)
        handled.add(keyOf(intent))
        sendEvent("onIntent", mapOf("at" to System.currentTimeMillis()))
      }
    }

    // a finished activity forgets what it handled, so sharing the same file again later works
    OnActivityDestroys {
      if (appContext.currentActivity?.isFinishing == true) handled.clear()
    }

    Function("takeIntent") {
      val intent = take(appContext.currentActivity) ?: return@Function null
      describe(context, intent)
    }

    AsyncFunction("readUri") { uri: String ->
      val bytes = context.contentResolver.openInputStream(Uri.parse(uri))?.use { it.readBytes() }
        ?: throw IllegalStateException("Cannot read the file")
      Base64.encodeToString(bytes, Base64.NO_WRAP)
    }

    // opens the calendar app with the event filled in (the person saves it there)
    Function("addCalendarEvent") { title: String, beginMs: Double, allDay: Boolean, description: String ->
      val intent = Intent(Intent.ACTION_INSERT)
        .setData(CalendarContract.Events.CONTENT_URI)
        .putExtra(CalendarContract.Events.TITLE, title)
        .putExtra(CalendarContract.Events.DESCRIPTION, description)
        .putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, beginMs.toLong())
        .putExtra(CalendarContract.EXTRA_EVENT_END_TIME, beginMs.toLong() + (if (allDay) 86400000L else 3600000L))
        .putExtra(CalendarContract.EXTRA_EVENT_ALL_DAY, allDay)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      val activity = appContext.currentActivity
      if (activity != null) activity.startActivity(intent) else context.startActivity(intent)
      true
    }

    Function("refreshShortcuts") {
      try { publishShortcuts(context) } catch (e: Throwable) { /* not supported */ }
    }
  }

  companion object {
    private const val SEEN = "pe_seen"
    @Volatile private var pending: Intent? = null
    // what the page already took: after a recreate (rotation, "don't keep activities") the system hands back the
    // original intent without our SEEN extra
    private val handled = java.util.Collections.synchronizedSet(HashSet<String>())

    private fun keyOf(i: Intent) = listOf(i.action, i.dataString, i.type, i.component?.className, i.getStringExtra(Intent.EXTRA_TEXT),
      i.getStringExtra(Intent.EXTRA_SUBJECT), streamOf(i), streamsOf(i)).joinToString("|")

    private fun take(activity: Activity?): Intent? {
      pending?.let { pending = null; return it }
      val intent = activity?.intent ?: return null
      if (intent.getBooleanExtra(SEEN, false) || !isRelevant(intent)) return null
      intent.putExtra(SEEN, true)
      val key = keyOf(intent)
      if (!handled.add(key)) return null
      return intent
    }

    private fun isAlias(intent: Intent) = intent.component?.className?.endsWith(".ConvertToPdf") == true

    fun isRelevant(intent: Intent): Boolean = when (intent.action) {
      // a share with neither a file nor text is nothing to open
      Intent.ACTION_SEND -> streamOf(intent) != null || !intent.getStringExtra(Intent.EXTRA_TEXT).isNullOrEmpty()
      Intent.ACTION_SEND_MULTIPLE -> streamsOf(intent).isNotEmpty()
      Intent.ACTION_VIEW -> intent.data != null
      else -> false
    }

    private fun describe(context: Context, intent: Intent): Map<String, Any?> {
      val files = mutableListOf<Map<String, Any?>>()
      var mode = "open"
      var text: String? = null
      when (intent.action) {
        Intent.ACTION_VIEW -> {
          val d = intent.data!!
          if (d.scheme == "pdfeditor") mode = d.lastPathSegment ?: d.host ?: "home"
          else files.add(fileInfo(context, d, intent.type))
        }
        Intent.ACTION_SEND -> {
          val uri = streamOf(intent)
          if (uri != null) files.add(fileInfo(context, uri, intent.type))
          else text = intent.getStringExtra(Intent.EXTRA_TEXT)
        }
        Intent.ACTION_SEND_MULTIPLE -> {
          for (uri in streamsOf(intent)) files.add(fileInfo(context, uri, intent.type))
        }
      }
      if (isAlias(intent)) mode = "convert"
      else if (files.isNotEmpty() && files.any { (it["mime"] as String?) != "application/pdf" && !(it["name"] as String).lowercase().endsWith(".pdf") }) mode = "import"
      else if (files.isEmpty() && text != null) mode = "import"
      return mapOf(
        "mode" to mode,
        "files" to files,
        "text" to text,
        "subject" to intent.getStringExtra(Intent.EXTRA_SUBJECT),
      )
    }

    @Suppress("DEPRECATION")
    private fun streamOf(intent: Intent): Uri? =
      if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
      else intent.getParcelableExtra(Intent.EXTRA_STREAM) as? Uri

    @Suppress("DEPRECATION")
    private fun streamsOf(intent: Intent): List<Uri> =
      (if (Build.VERSION.SDK_INT >= 33) intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java)
      else intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM)) ?: emptyList()

    private fun fileInfo(context: Context, uri: Uri, type: String?): Map<String, Any?> {
      var name: String? = null
      var size: Long? = null
      try {
        context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { c ->
          if (c.moveToFirst()) {
            val ni = c.getColumnIndex(OpenableColumns.DISPLAY_NAME)
            val si = c.getColumnIndex(OpenableColumns.SIZE)
            if (ni >= 0) name = c.getString(ni)
            if (si >= 0 && !c.isNull(si)) size = c.getLong(si)
          }
        }
      } catch (e: Throwable) { /* no metadata */ }
      var mime = try { context.contentResolver.getType(uri) } catch (e: Throwable) { null }
      if (mime == null || mime == "application/octet-stream") {
        val ext = (name ?: uri.lastPathSegment ?: "").substringAfterLast('.', "").lowercase()
        mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext) ?: mime ?: type
      }
      if (name == null) name = uri.lastPathSegment?.substringAfterLast('/') ?: "file"
      return mapOf("uri" to uri.toString(), "name" to name, "mime" to mime, "size" to size?.toDouble())
    }

    /** the menu shown when the app icon is held */
    fun publishShortcuts(context: Context) {
      val list = listOf(
        Triple("scan", "Scan document", R.drawable.pe_sc_scan),
        Triple("open", "Edit a PDF", R.drawable.pe_sc_open),
        Triple("sign", "Sign a PDF", R.drawable.pe_sc_sign),
        Triple("convert", "Convert to PDF", R.drawable.pe_sc_convert),
      ).mapIndexed { i, (id, label, icon) ->
        ShortcutInfoCompat.Builder(context, id)
          .setShortLabel(label)
          .setLongLabel(label)
          .setIcon(IconCompat.createWithResource(context, icon))
          .setIntent(actionIntent(context, id))
          .setRank(i)
          .build()
      }
      ShortcutManagerCompat.setDynamicShortcuts(context, list)
    }

    fun actionIntent(context: Context, action: String): Intent =
      Intent(Intent.ACTION_VIEW, Uri.parse("pdfeditor://action/$action"))
        .setClassName(context.packageName, "${context.packageName}.MainActivity")
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
  }
}

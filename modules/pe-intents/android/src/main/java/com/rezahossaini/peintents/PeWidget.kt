package com.rezahossaini.peintents

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.widget.RemoteViews

/** Home-screen widget: one tap to scan, open, sign or convert. */
class PeWidget : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    for (id in ids) {
      val views = RemoteViews(context.packageName, R.layout.pe_widget)
      val buttons = listOf(R.id.pe_w_scan to "scan", R.id.pe_w_open to "open", R.id.pe_w_sign to "sign", R.id.pe_w_convert to "convert")
      buttons.forEachIndexed { i, (view, action) ->
        val pi = PendingIntent.getActivity(
          context, 7100 + i, PeIntentsModule.actionIntent(context, action),
          PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        views.setOnClickPendingIntent(view, pi)
      }
      manager.updateAppWidget(id, views)
    }
  }
}

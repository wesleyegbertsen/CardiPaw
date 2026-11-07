package com.cardipaw.app.widget;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProviderInfo;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import androidx.appcompat.app.AppCompatActivity;
import com.cardipaw.app.MainActivity;
import com.cardipaw.app.R;

/**
 * Picks the pet for one single-pet widget: when it is added, when reconfigured (API 31+
 * long-press), and when its pet was deleted (the widget's tap opens this). Pets come from the
 * snapshot: native code can't read the app's IndexedDB.
 */
public class WidgetConfigureActivity extends AppCompatActivity {

    private int widgetId = AppWidgetManager.INVALID_APPWIDGET_ID;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Backing out must not add the widget.
        setResult(RESULT_CANCELED);
        Bundle extras = getIntent().getExtras();
        if (extras != null) widgetId = extras.getInt(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId);
        if (widgetId == AppWidgetManager.INVALID_APPWIDGET_ID) {
            finish();
            return;
        }
        // Exported (the launcher starts it): any app could pass another widget's id.
        AppWidgetManager mgr = AppWidgetManager.getInstance(this);
        AppWidgetProviderInfo info = mgr.getAppWidgetInfo(widgetId);
        if (info == null || !new ComponentName(this, PetWidgetProvider.class).equals(info.provider)) {
            finish();
            return;
        }
        // "Choose a pet" (its tap opens this picker) instead of the blank initial layout, in case
        // the launcher adds the widget while this is dismissed.
        WidgetUpdater.updatePet(this, mgr, widgetId);
        WidgetSnapshot s = WidgetStore.readSnapshot(this);
        Context text = WidgetUpdater.localized(this, s);
        setContentView(R.layout.activity_widget_configure);
        // The dialog's own title; the layout has no title view.
        setTitle(text.getString(R.string.widget_configure_title));
        if (s == null || s.pets.isEmpty()) {
            TextView message = findViewById(R.id.configure_message);
            message.setText(text.getString(s == null ? R.string.widget_open_app_first : R.string.widget_no_pets));
            message.setVisibility(View.VISIBLE);
            Button open = findViewById(R.id.configure_open_app);
            open.setText(text.getString(R.string.widget_open_app));
            open.setVisibility(View.VISIBLE);
            open.setOnClickListener(v -> {
                startActivity(new Intent(this, MainActivity.class));
                finish();
            });
            return;
        }
        LinearLayout list = findViewById(R.id.configure_list);
        for (WidgetSnapshot.Pet pet : s.pets) {
            View row = getLayoutInflater().inflate(R.layout.widget_configure_item, list, false);
            ((TextView) row.findViewById(R.id.initial)).setText(pet.initial);
            ((TextView) row.findViewById(R.id.name)).setText(pet.name);
            row.setOnClickListener(v -> pick(pet.id));
            list.addView(row);
        }
    }

    private void pick(String petId) {
        WidgetStore.setPetId(this, widgetId, petId);
        WidgetUpdater.updatePet(this, AppWidgetManager.getInstance(this), widgetId);
        setResult(RESULT_OK, new Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId));
        finish();
    }
}

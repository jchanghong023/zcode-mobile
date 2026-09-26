package dev.jchanghong.zcode;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.OutputStream;

/** WebView 内存中的 Blob 不能交给 DownloadManager；由用户选定文件后写入该文档 URI。 */
@CapacitorPlugin(name = "ZCodeFileSave")
public class BlobSavePlugin extends Plugin {

    @PluginMethod
    public void save(PluginCall call) {
        String base64 = call.getString("base64");
        String suggestedName = call.getString("suggestedName");
        if (base64 == null || suggestedName == null || suggestedName.trim().isEmpty()) {
            call.reject("Missing file data or name");
            return;
        }
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE)
            .setType("*/*")
            .putExtra(Intent.EXTRA_TITLE, suggestedName);
        startActivityForResult(call, intent, "onSaveResult");
    }

    @ActivityCallback
    private void onSaveResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        Uri destination = data == null ? null : data.getData();
        if (result.getResultCode() != Activity.RESULT_OK || destination == null) {
            JSObject response = new JSObject();
            response.put("success", false);
            response.put("canceled", true);
            call.resolve(response);
            return;
        }
        getBridge().execute(() -> {
            try {
                byte[] bytes = Base64.decode(call.getString("base64"), Base64.DEFAULT);
                // 文档提供者可能是云盘；文件 IO 交给 Capacitor 后台线程，避免阻塞界面。
                try (OutputStream stream = getContext().getContentResolver().openOutputStream(destination, "w")) {
                    if (stream == null) throw new IllegalStateException("Unable to open destination");
                    stream.write(bytes);
                }
                JSObject response = new JSObject();
                response.put("success", true);
                response.put("path", destination.toString());
                call.resolve(response);
            } catch (Exception error) {
                call.reject("Unable to save file", error);
            }
        });
    }
}

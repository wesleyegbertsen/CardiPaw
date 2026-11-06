package com.cardipaw.app;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ContentResolver;
import android.content.Intent;
import android.content.UriPermission;
import android.database.Cursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.DocumentsContract;
import android.provider.DocumentsContract.Document;
import android.system.ErrnoException;
import android.system.OsConstants;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.FileNotFoundException;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.SyncFailedException;
import java.nio.charset.StandardCharsets;
import java.util.regex.Pattern;

/**
 * Writes automatic backups into a folder the owner picked (Storage Access Framework). Stateless:
 * the web code passes the folder's tree URI with every call. Only files named like a backup are
 * ever written, listed or deleted. Every method catches everything: an exception escaping a
 * plugin method crashes the app (Capacitor's Bridge rethrows it).
 */
@CapacitorPlugin(name = "BackupFolder")
public class BackupFolderPlugin extends Plugin {

    /** Same pattern as BACKUP_FILE_PATTERN in src/utils/backupFiles.ts (a test keeps them equal). */
    static final Pattern BACKUP_NAME = Pattern.compile("^cardipaw-backup-(\\d{4}-\\d{2}-\\d{2})\\.json$");
    private static final int GRANT = Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION;

    private static final class InvalidName extends RuntimeException {}

    @PluginMethod
    public void pickFolder(PluginCall call) {
        try {
            Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE)
                .addFlags(GRANT | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
            startActivityForResult(call, intent, "pickResult");
        } catch (ActivityNotFoundException e) {
            call.reject("No folder picker", "UNAVAILABLE");
        } catch (Exception e) {
            fail(call, e);
        }
    }

    @ActivityCallback
    private void pickResult(PluginCall call, ActivityResult result) {
        if (call == null) return; // the app was restarted while the picker was open
        try {
            Intent data = result.getData();
            Uri tree = data == null ? null : data.getData();
            if (result.getResultCode() != Activity.RESULT_OK || tree == null) {
                call.reject("Cancelled", "CANCELLED");
                return;
            }
            resolver().takePersistableUriPermission(tree, GRANT);
            JSObject ret = new JSObject();
            ret.put("uri", tree.toString());
            ret.put("name", folderName(tree));
            call.resolve(ret);
        } catch (Exception e) {
            fail(call, e);
        } finally {
            // startActivityForResult saved the call in the bridge, and nothing else releases it.
            call.release(getBridge());
        }
    }

    @PluginMethod
    public void releaseFolder(PluginCall call) {
        try {
            Uri tree = Uri.parse(required(call, "uri"));
            for (UriPermission p : resolver().getPersistedUriPermissions()) {
                if (p.getUri().equals(tree)) resolver().releasePersistableUriPermission(tree, GRANT);
            }
            call.resolve();
        } catch (Exception e) {
            fail(call, e);
        }
    }

    @PluginMethod
    public void checkFolder(PluginCall call) {
        try {
            JSObject ret = new JSObject();
            ret.put("name", folderName(tree(call)));
            call.resolve(ret);
        } catch (Exception e) {
            fail(call, e);
        }
    }

    @PluginMethod
    public void writeFile(PluginCall call) {
        try {
            Uri tree = tree(call);
            String name = backupName(call);
            byte[] bytes = required(call, "text").getBytes(StandardCharsets.UTF_8);
            folderName(tree); // the grant outlives a deleted folder: check the folder itself
            Uri doc = findChild(tree, name);
            if (doc == null) doc = create(tree, name);
            write(doc, bytes);
            Long size = sizeOf(doc);
            if (size != null && size != bytes.length) {
                // A provider that ignored "t" kept old bytes past the end: start the file over.
                DocumentsContract.deleteDocument(resolver(), doc);
                doc = create(tree, name);
                write(doc, bytes);
                size = sizeOf(doc);
                if (size != null && size != bytes.length) throw new IOException("Size mismatch");
            }
            call.resolve();
        } catch (Exception e) {
            fail(call, e);
        }
    }

    @PluginMethod
    public void listFiles(PluginCall call) {
        try {
            Uri tree = tree(call);
            JSArray names = new JSArray();
            try (Cursor c = children(tree, Document.COLUMN_DISPLAY_NAME)) {
                while (c.moveToNext()) {
                    String name = c.getString(0);
                    if (name != null && BACKUP_NAME.matcher(name).matches()) names.put(name);
                }
            }
            JSObject ret = new JSObject();
            ret.put("names", names);
            call.resolve(ret);
        } catch (Exception e) {
            fail(call, e);
        }
    }

    @PluginMethod
    public void deleteFile(PluginCall call) {
        try {
            Uri tree = tree(call);
            Uri doc = findChild(tree, backupName(call));
            if (doc != null) DocumentsContract.deleteDocument(resolver(), doc);
            call.resolve();
        } catch (Exception e) {
            fail(call, e);
        }
    }

    // --- helpers ---

    private ContentResolver resolver() { return getContext().getContentResolver(); }

    private static String required(PluginCall call, String key) {
        String value = call.getString(key);
        if (value == null || value.isEmpty()) throw new IllegalStateException("Missing " + key);
        return value;
    }

    /**
     * The folder, if CardiPaw still holds a persisted write grant for it. Checked here because the
     * provider alone can't tell: after a release, the picker's grant keeps working until the
     * process ends.
     */
    private Uri tree(PluginCall call) {
        Uri tree = Uri.parse(required(call, "uri"));
        for (UriPermission p : resolver().getPersistedUriPermissions()) {
            if (p.getUri().equals(tree) && p.isWritePermission()) return tree;
        }
        throw new SecurityException("No write grant");
    }

    private static String backupName(PluginCall call) {
        String name = call.getString("name");
        if (name == null || !BACKUP_NAME.matcher(name).matches()) throw new InvalidName();
        return name;
    }

    private static Uri folderDoc(Uri tree) {
        return DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
    }

    /** The folder's display name; FileNotFoundException when it is gone or no longer a folder. */
    private String folderName(Uri tree) throws FileNotFoundException {
        String[] cols = { Document.COLUMN_DISPLAY_NAME, Document.COLUMN_MIME_TYPE };
        try (Cursor c = resolver().query(folderDoc(tree), cols, null, null, null)) {
            if (c == null || !c.moveToFirst() || !Document.MIME_TYPE_DIR.equals(c.getString(1))) {
                throw new FileNotFoundException("Folder missing");
            }
            return c.getString(0);
        }
    }

    /** Cursor over the folder's children; column 0 is `column`, column 1 the document id. */
    private Cursor children(Uri tree, String column) throws FileNotFoundException {
        Uri uri = DocumentsContract.buildChildDocumentsUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
        Cursor c = resolver().query(uri, new String[] { column, Document.COLUMN_DOCUMENT_ID }, null, null, null);
        if (c == null) throw new FileNotFoundException("Folder missing");
        return c;
    }

    /** Exact-name match; providers ignore selection args, so the filter is here. */
    private Uri findChild(Uri tree, String name) throws FileNotFoundException {
        try (Cursor c = children(tree, Document.COLUMN_DISPLAY_NAME)) {
            while (c.moveToNext()) {
                if (name.equals(c.getString(0))) return DocumentsContract.buildDocumentUriUsingTree(tree, c.getString(1));
            }
        }
        return null;
    }

    private Uri create(Uri tree, String name) throws IOException {
        Uri doc = DocumentsContract.createDocument(resolver(), folderDoc(tree), "application/json", name);
        if (doc == null) throw new IOException("Could not create the file");
        if (!name.equals(displayName(doc))) {
            // e.g. "name (1).json" or an added extension: never leave a stray file behind.
            try { DocumentsContract.deleteDocument(resolver(), doc); } catch (Exception ignored) { }
            throw new IOException("The folder renamed the file");
        }
        return doc;
    }

    /** "wt": with "w" alone, ExternalStorageProvider keeps the old bytes past the end. */
    private void write(Uri doc, byte[] bytes) throws IOException {
        ParcelFileDescriptor pfd = resolver().openFileDescriptor(doc, "wt");
        if (pfd == null) throw new IOException("Could not open the file");
        try (FileOutputStream out = new ParcelFileDescriptor.AutoCloseOutputStream(pfd)) {
            out.write(bytes);
            out.flush();
            try { out.getFD().sync(); } catch (SyncFailedException e) { /* pipes from cloud providers can't sync */ }
        }
    }

    private String displayName(Uri doc) throws FileNotFoundException {
        try (Cursor c = resolver().query(doc, new String[] { Document.COLUMN_DISPLAY_NAME }, null, null, null)) {
            if (c == null || !c.moveToFirst()) throw new FileNotFoundException("File missing");
            return c.getString(0);
        }
    }

    /** Null when the provider doesn't report a size. */
    private Long sizeOf(Uri doc) throws FileNotFoundException {
        try (Cursor c = resolver().query(doc, new String[] { Document.COLUMN_SIZE }, null, null, null)) {
            if (c == null || !c.moveToFirst() || c.isNull(0)) return null;
            return c.getLong(0);
        }
    }

    private static void fail(PluginCall call, Exception e) {
        String code;
        if (e instanceof InvalidName) code = "INVALID_NAME";
        else if (e instanceof SecurityException) code = "PERMISSION_REVOKED";
        else if (e instanceof FileNotFoundException || e instanceof IllegalArgumentException) code = "FOLDER_MISSING";
        else if (isNoSpace(e)) code = "STORAGE_FULL";
        else if (e instanceof IOException) code = "WRITE_FAILED";
        else code = "FAILED";
        // The class name only: messages can contain the folder's URI.
        call.reject(e.getClass().getSimpleName(), code);
    }

    private static boolean isNoSpace(Throwable e) {
        for (Throwable t = e; t != null; t = t.getCause()) {
            if (t instanceof ErrnoException && ((ErrnoException) t).errno == OsConstants.ENOSPC) return true;
            String m = t.getMessage();
            if (m != null && (m.contains("ENOSPC") || m.contains("No space left"))) return true;
        }
        return false;
    }
}

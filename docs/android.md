# Android app

Installing and updating the Android app, checking an APK's signing certificate, automatic backups, reminders and permissions. For a quick overview see the [README](../README.md#android).

## Installing

Every [release](https://github.com/wesleyegbertsen/CardiPaw/releases) includes the Android app as `cardipaw-X.Y.Z.apk`. CardiPaw is not on Google Play yet.

1. Download the APK on your phone from the latest release and open it.
2. Allow your browser or file manager to install unknown apps when Android asks. Google Play Protect may warn about an app it doesn't know; that is expected for apps installed outside Play.

## Updating

Install the APK of a newer release over the installed app. Your pets and readings stay. The app does not update itself. To find out about new releases:

- **Settings → Updates** shows the installed version and opens the latest release on GitHub in your browser. This needs no network access in the app.
- **Check automatically** (in the same place, off by default) asks `api.github.com` about once a day, and whenever you tap **Check now**, whether a newer release exists, and shows a notice when there is one. While it's on, the same place shows when it last checked. GitHub then sees your IP address and the information the app's browser engine sends with every request, such as its user agent (which includes the Android version and device model) and language. No pet data is sent.
- Or let something outside the app watch for you: [Obtainium](https://github.com/ImranR98/Obtainium) (add `https://github.com/wesleyegbertsen/CardiPaw`; it can also install the APK), or on GitHub choose **Watch → Custom → Releases** on this repository to get an email per release.

Whichever you use, check the signing certificate of a new APK (see [Checking an APK](#checking-an-apk) below).

- Android refuses to install an older APK over a newer one. **Don't uninstall to get around that:** Android Auto Backup is disabled, so uninstalling deletes all of the app's data. If you really need to go back, [export](features.md#data-export--import) first, or keep a recent [automatic backup](#automatic-backups).
- Export regularly, or turn on [automatic backups](#automatic-backups): Android's own backup is off, so these files are the only copies of the app's data. Keep one somewhere safe, off the phone.

## Checking an APK

Every release's notes list the SHA-256 of the certificate the APK is signed with, and it is the same for every release. You can compare it with the output of `apksigner verify --print-certs cardipaw-X.Y.Z.apk` (Android SDK build-tools), or with an app such as AppVerifier. apksigner prints it in the same form as the release notes (lower-case hex without colons); other tools may show `AB:CD:…`, and case and colons don't matter. If it ever differs, don't install that APK.

## Coming from a CI debug build

Those APKs are signed with a different key, so Android won't install a release over them. Once: export your data in the debug app, uninstall it, install the release APK and import the file.

## Automatic backups

**Settings → Automatic backups** (off by default) saves the same file as Export into a folder you pick on the phone. CardiPaw never uploads it: to keep a copy off the phone, pick a folder that a sync app such as Nextcloud or Syncthing copies elsewhere.

- **Pick a subfolder**, such as a new `Documents/CardiPawBackups`. Android's folder picker doesn't allow the top level of the storage, nor Download on Android 11 and later. Google Drive's picker gives apps no folder access, so use a folder that a sync app copies.
- **Use one folder per phone.** The file names carry only the date, so two phones writing to the same folder overwrite each other's backups.
- **When it writes:** 3 seconds after you change something (a reading, a pet, a note or an import), at startup and when you return to the app if a backup is due, and, if a change is still waiting when you leave the app, right then.
- **One file per day or per week** (**Start a new file**), named `cardipaw-backup-YYYY-MM-DD.json` for the day or the week's Monday. It is overwritten with the latest data during that day or week.
- **Backups to keep** (3, 7, 14 or 30): older backup files are deleted. Only files named `cardipaw-backup-*.json` are ever deleted; anything else in the folder is left alone.
- **Nothing is written while CardiPaw has no pets**, so a fresh install or lost app data never replaces or prunes your good backups.
- **The files are not encrypted.** Any app that syncs or can read the folder can see your data.
- **To restore**, use **Settings → Import** with one of the files, on this phone or a new one.
- A pet you delete stays in the older files until they are pruned.
- Turning automatic backups off, or uninstalling CardiPaw, keeps the files already written; CardiPaw only gives up its access to the folder.
- If the folder is deleted, or CardiPaw can no longer write to it, Settings says so and a notice shows in the rest of the app; choose the folder again there.

## Reminders

Tap the bell on a pet's page to be reminded to measure that pet, at a time and on the weekdays you pick. Reminders are local notifications scheduled on your phone; nothing about them is sent anywhere. Their settings stay on the phone and aren't included in exports, so after importing your data on a new phone, turn them on again.

- A calendar day that already has a reading for the pet gets no reminder. Days start at midnight: a 00:30 reminder still comes after a reading at 23:30 the evening before.
- Reminders are scheduled 14 days ahead and topped up whenever you open the app. If you don't open CardiPaw for two weeks, they stop until you do.
- A reminder that came due while the phone was off is skipped; the later ones still come.
- Battery savers on some phones (Xiaomi, Samsung and others) can delay reminders or drop them.
- On a secured lock screen, Android shows that CardiPaw has a notification but hides its text.
- Reminders use the phone's default notification sound and vibrate (as far as its sound mode allows). Earlier versions used a "Measuring reminders" category that never vibrated; the update replaces it with a new one of the same name, so changes you made to the old one in Android's notification settings (turning it off, a custom sound, vibration turned on by hand) are reset once. Reminders from the old version that are still showing, or already due, when CardiPaw is first opened after the update are cleared once.
- Besides CardiPaw's "Measuring reminders", Android's notification settings for the app also list a "Default" channel; it comes with the notifications plugin.

## Camera

The app also declares the `CAMERA` permission, used only by the opt-in [camera counting](features.md#camera-counting-experimental); Android asks you the first time you allow it. How the video is handled is described there. The camera is declared optional, so phones without one can still install the app. If CardiPaw is ever listed on Google Play, its data-safety form would say: camera permission declared, no data collected, no data shared.
